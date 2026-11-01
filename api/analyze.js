const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
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
    const instructions = `Sei un supporto al ragionamento clinico ortopedico destinato a un medico specialista. Non sostituisci il giudizio clinico. Non inventare dati mancanti e non assegnare percentuali numeriche non validate. Distingui reperti clinici da reperti strumentali e segnala possibili reperti incidentali. Se mancano dati essenziali, dichiaralo. Evidenzia eventuali red flags. Le proposte terapeutiche devono essere opzioni da convalidare dal medico e devono ricordare di verificare controindicazioni, allergie, comorbilità, terapie concomitanti e linee guida locali. Non richiedere né ripetere dati identificativi del paziente.\n\nRispondi in italiano, in modo conciso e strutturato con queste sezioni:\n1. Diagnosi differenziali ordinate per plausibilità (molto probabile / probabile / possibile / poco supportata), con elementi a favore e contro.\n2. Correlazione clinico-strumentale.\n3. Dati mancanti e red flags da verificare.\n4. Eventuali approfondimenti diagnostici, solo se giustificati.\n5. Opzioni terapeutiche ragionevoli e principali cautele da verificare.`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-5-mini', instructions, input, max_output_tokens: 1800 })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data?.error?.message || 'Errore OpenAI API' });
    const analysis = data.output_text || (data.output || []).flatMap(x => x.content || []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
    if (!analysis) return res.status(502).json({ error: 'Risposta AI senza testo' });
    return res.status(200).json({ analysis });
  } catch (e) {
    return res.status(500).json({ error: e?.message || 'Errore interno' });
  }
}

