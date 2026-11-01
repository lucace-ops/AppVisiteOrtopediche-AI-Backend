const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function getOutputText(data) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  for (const item of (data?.output || [])) {
    for (const part of (item?.content || [])) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) return part.text.trim();
    }
  }
  return '';
}

function safeParseStructured(data) {
  const raw = getOutputText(data);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  // Fallback difensivo: alcuni client/proxy possono restituire testo con delimitatori.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
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
- Terapia prudente e proporzionata ai dati; il medico deve validarla e verificare controindicazioni, allergie, comorbilità, terapie concomitanti e protocolli locali.
- Non richiedere o ripetere identificativi del paziente.
- L'analisi deve essere molto compatta: circa 120-200 parole, massimo 240.
- Nell'analisi usa solo: Sintesi; Valutazione; Da verificare; Condotta; Red flags.
- diagnosis_suggestion: 1-2 frasi prudenti utilizzabili nel campo Diagnosi/valutazione.
- therapy_suggestion: 1-3 frasi sintetiche utilizzabili nel campo Terapia.
- questions: al massimo 4 dati/domande discriminanti realmente utili.`;

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        analysis: { type: 'string' },
        diagnosis_suggestion: { type: 'string' },
        therapy_suggestion: { type: 'string' },
        questions: { type: 'array', items: { type: 'string' }, maxItems: 4 }
      },
      required: ['analysis', 'diagnosis_suggestion', 'therapy_suggestion', 'questions']
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        instructions,
        input,
        max_output_tokens: 2000,
        text: { format: { type: 'json_schema', name: 'orthopedic_clinical_review', strict: true, schema } }
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Errore OpenAI API' });

    if (data?.status === 'incomplete') {
      const reason = data?.incomplete_details?.reason || 'limite di generazione';
      return res.status(502).json({ error: `Risposta AI interrotta (${reason}). Riprova.` });
    }

    const parsed = safeParseStructured(data);
    if (!parsed) {
      const refusal = (data?.output || []).flatMap(x => x?.content || []).find(x => x?.type === 'refusal')?.refusal;
      if (refusal) return res.status(422).json({ error: `La AI non ha prodotto la revisione: ${refusal}` });
      return res.status(502).json({ error: 'Risposta AI ricevuta ma non decodificabile. Riprova.' });
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
