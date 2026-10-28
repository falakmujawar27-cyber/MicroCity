/**
 * Server-side AI proxy. Provider credentials never reach the browser.
 *
 * Code calculates every number; the model only explains or suggests using
 * the facts the client has already computed from authorised records. When no
 * provider is configured the endpoint reports that honestly and the client
 * shows a separately labelled rule-based explanation.
 */
export interface AiSettings {
  apiUrl: string
  apiKey: string
  model: string
}

export type AiTask =
  | 'explain-finding'
  | 'report-summary'
  | 'option-comparison'
  | 'categorise-issue'
  | 'ask-data'

export function loadAiSettings(env: NodeJS.ProcessEnv = process.env): AiSettings | null {
  const apiKey = env.AI_API_KEY?.trim()
  const model = env.AI_MODEL?.trim()
  const base = env.AI_BASE_URL?.trim().replace(/\/+$/, '')
  if (!apiKey || !model || !base) return null
  const apiUrl = env.AI_API_URL?.trim() || `${base}/chat/completions`
  return { apiUrl, apiKey, model }
}

const BASE_RULES = [
  'You are the explanation assistant inside MicroCity, a campus infrastructure planning tool.',
  'You receive COMPUTED FACTS produced by deterministic application code from authorised records.',
  'Hard rules:',
  '- Use only the supplied facts. Never invent measurements, savings, costs, causes or records.',
  '- Never claim that a leak, fault or cause is proven unless the facts state it.',
  '- Use cautious wording for utilities: could indicate, may be associated with, worth verifying.',
  '- State missing inputs and limitations when they affect the conclusion.',
  '- Do not approve spending, change permissions or instruct privileged actions.',
  '- Keep the answer concise (maximum 170 words), plain prose. No preamble about being an AI.',
].join('\n')

const TASK_RULES: Record<AiTask, string> = {
  'explain-finding': [
    'Task: explain one finding to an estates user.',
    'Structure: what the numbers show; why it matters; 2-3 practical options grounded in the facts; what evidence is missing.',
  ].join('\n'),
  'report-summary': [
    'Task: write a concise management summary of the supplied report facts.',
    'Cover the most material verified findings, decisions and limitations. Do not add any new figures.',
  ].join('\n'),
  'option-comparison': [
    'Task: compare the supplied intervention options.',
    'Explain trade-offs and risks using only the stated costs, effects, assumptions and risks. Do not calculate new figures.',
    'If a cost or effect is null, say it is not recorded rather than assuming it.',
  ].join('\n'),
  'categorise-issue': [
    'Task: suggest one complaint category from the supplied list and, when the description clearly names a place, one room from the supplied rooms.',
    'Reply exactly in the form:',
    'CATEGORY: <one category>',
    'ROOM: <room id or room code, or NONE>',
    'Then one short sentence of rationale. If uncertain about the category, choose "Other" and say why. Never invent a room that is not in the supplied list.',
  ].join('\n'),
  'ask-data': [
    'Task: answer the user question strictly from the supplied computed facts.',
    'If the facts do not contain the answer, say that the current records do not support an answer.',
  ].join('\n'),
}

export interface AiAnswer {
  ok: boolean
  text: string | null
  error: string | null
  model: string | null
}

export async function runAiTask(
  settings: AiSettings,
  task: AiTask,
  facts: unknown,
  question?: string,
): Promise<AiAnswer> {
  const factsText = JSON.stringify(facts)
  if (factsText.length > 24_000) {
    return { ok: false, text: null, error: 'The evidence payload is too large for the AI endpoint.', model: settings.model }
  }
  const userContent = [
    TASK_RULES[task],
    question ? `User question: ${question.slice(0, 500)}` : '',
    'COMPUTED FACTS (JSON):',
    factsText,
  ]
    .filter(Boolean)
    .join('\n\n')

  try {
    const response = await fetch(settings.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: task === 'categorise-issue' ? 0 : 0.2,
        max_tokens: 650,
        messages: [
          { role: 'system', content: `${BASE_RULES}\n\n${TASK_RULES[task]}` },
          { role: 'user', content: userContent },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`
      try {
        const body = (await response.json()) as { error?: { message?: string } }
        if (body?.error?.message) detail = `${detail} - ${body.error.message}`
      } catch {
        /* status is enough */
      }
      return {
        ok: false,
        text: null,
        error:
          response.status === 401 || response.status === 403
            ? 'The AI provider rejected the server credentials. Check AI_API_KEY and AI_MODEL.'
            : `The AI provider returned an error (${detail}). Rule-based explanations remain available.`,
        model: settings.model,
      }
    }

    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const text = body.choices?.[0]?.message?.content?.trim() ?? null
    if (!text) {
      return { ok: false, text: null, error: 'The AI provider returned no text.', model: settings.model }
    }
    return { ok: true, text, error: null, model: settings.model }
  } catch (error) {
    return {
      ok: false,
      text: null,
      error:
        `Could not reach the AI provider (${error instanceof Error ? error.message : String(error)}). ` +
        'Rule-based explanations remain available.',
      model: settings.model,
    }
  }
}
