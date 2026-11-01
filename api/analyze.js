const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function extractText(data) {
  return data.output_text || (data.output || [])
    .flatMap(x => x.content || [])
    .filter(x => x.type === 'output_text')
    .map(x => x.text)
    .join('\n');
}

function parseModelJson(text) {
  const cleaned = String(text || '').trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { return null; }
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo non consentito' });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY non configurata sul server' });

  try {
    const body = req.body || {};
    const anamnesis = String(body.anamnesis || '').slice(0, 12000);
    const objective = String(body.objective || '').slice(0, 12000);
    const diagnostics = String(body.diagnostics || '').slice(0, 18000);
    if (!anamnesis && !objective && !diagnostics) return res.status(400).json({ error: 'Caso clinico vuoto' });

    const input = `ANAMNESI\n${anamnesis || '[non compilata]'}\n\nESAME OBIETTIVO\n${objective || '[non compilato]'}\n\nESAMI DIAGNOSTICI / IMAGING\n${diagnostics || '[non disponibili]'}`;

    const instructions = `Sei un revisore clinico ortopedico destinato a un medico specialista. Il tuo compito non è sostituire il giudizio clinico, ma fare da secondo paio di occhi critico.

REGOLE DI RAGIONAMENTO:
- Non inventare dati mancanti e non assegnare percentuali numeriche non validate.
- Non cercare di mantenere artificialmente in vita ogni diagnosi. Se i dati sono insufficienti, dichiaralo.
- In caso di discordanza clinico-strumentale, evidenziala prima di ipotizzare lesioni occulte o falsi negativi dell'imaging.
- Non proporre automaticamente una lesione 'occulta' o 'non vista alla RM' per spiegare una discordanza: prima considera affidabilità e completezza dell'esame clinico, timing, qualità/appropriatezza dell'imaging e necessità di rivalutazione.
- Identifica eventuali incoerenze interne nei dati (per esempio due reperti tra loro incompatibili).
- Distingui reperti pertinenti al problema attuale da reperti potenzialmente incidentali o preesistenti.
- Evidenzia i dati mancanti che avrebbero reale valore discriminante e formula al massimo 4 domande cliniche mirate.
- Evidenzia red flags solo quando pertinenti.
- Suggerisci approfondimenti diagnostici solo se giustificati dai dati disponibili.
- Le opzioni terapeutiche sono proposte da validare dal medico: ricordare di verificare controindicazioni, allergie, comorbilità, terapie concomitanti e protocolli/linee guida locali.
- Non richiedere né ripetere dati identificativi del paziente.

RESTITUISCI ESCLUSIVAMENTE JSON VALIDO, senza markdown e senza testo prima o dopo, con questa struttura:
{
  "analysis": "Testo conciso e leggibile con sezioni: Sintesi clinica; Ipotesi principale; Alternative da considerare; Discordanze clinico-strumentali; Incoerenze/reperti incidentali; Dati mancanti e red flags; Approfondimenti; Opzioni terapeutiche.",
  "diagnosis_suggestion": "Una formulazione sintetica e prudente adatta al campo Diagnosi/valutazione. Non definirla definitiva e non includere dati non dimostrati.",
  "therapy_suggestion": "Indicazioni terapeutiche sintetiche coerenti con i dati, formulate come proposta clinica da validare. Se i dati non consentono una terapia specifica, dichiararlo.",
  "questions": ["domanda mirata 1", "domanda mirata 2"]
}
Le domande devono essere massimo 4 e solo se realmente utili a discriminare le ipotesi.`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        instructions,
        input,
        max_output_tokens: 2200
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Errore OpenAI API' });
    const raw = extractText(data);
    if (!raw) return res.status(502).json({ error: 'Risposta AI senza testo' });

    const parsed = parseModelJson(raw);
    if (!parsed) {
      return res.status(200).json({ analysis: raw, diagnosis_suggestion: '', therapy_suggestion: '', questions: [] });
    }

    return res.status(200).json({
      analysis: String(parsed.analysis || ''),
      diagnosis_suggestion: String(parsed.diagnosis_suggestion || ''),
      therapy_suggestion: String(parsed.therapy_suggestion || ''),
      questions: Array.isArray(parsed.questions) ? parsed.questions.slice(0, 4).map(String) : []
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Errore interno' });
  }
}
