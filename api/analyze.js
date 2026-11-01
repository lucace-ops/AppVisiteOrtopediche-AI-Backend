const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function extractText(data) {
  return data.output_text || (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
}

function parseModelJson(text) {
  const cleaned = String(text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
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

    const instructions = `Sei un revisore clinico ortopedico per un medico specialista. Devi essere rapido, critico e clinicamente utile, non enciclopedico. Non sostituisci il giudizio del medico.

REGOLE:
- Non inventare dati, percentuali o lesioni occulte per salvare una diagnosi.
- Se clinica e imaging discordano, segnala prima la discordanza e cosa serve per chiarirla.
- Segnala incoerenze interne e reperti probabilmente incidentali.
- Massimo 3 ipotesi/alternative complessive e massimo 4 dati mancanti realmente discriminanti.
- Evita liste di esami possibili: proponi approfondimenti solo se cambierebbero concretamente la gestione.
- Evita dettagli tecnici sull'imaging salvo siano decisivi.
- Terapia prudente e proporzionata ai dati; il medico deve validarla e verificare controindicazioni, allergie, comorbilità, terapie concomitanti e protocolli locali.
- Non richiedere o ripetere identificativi del paziente.

L'ANALISI deve essere leggibile in circa 15 secondi: idealmente 150-220 parole, mai oltre 280. Usa solo queste sezioni brevi: Sintesi; Valutazione; Da verificare; Condotta; Red flags.

RESTITUISCI ESCLUSIVAMENTE JSON VALIDO, senza markdown. È fondamentale compilare SEMPRE diagnosis_suggestion e therapy_suggestion, perché alimentano pulsanti dell'app. Struttura esatta:
{
  "diagnosis_suggestion": "1-2 frasi prudenti, direttamente utilizzabili nel campo Diagnosi/valutazione e modificabili dal medico",
  "therapy_suggestion": "1-3 frasi sintetiche, direttamente utilizzabili nel campo Terapia e modificabili dal medico",
  "questions": ["massimo 4 domande/dati discriminanti, solo se utili"],
  "analysis": "revisione compatta nelle cinque sezioni richieste"
}`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', instructions, input, max_output_tokens: 1000 })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Errore OpenAI API' });
    const raw = extractText(data);
    if (!raw) return res.status(502).json({ error: 'Risposta AI senza testo' });
    const parsed = parseModelJson(raw);
    if (!parsed) return res.status(502).json({ error: 'Risposta AI incompleta/non strutturata. Premi Rianalizza.' });

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
