import { createServer } from 'node:http'

const port = Number(process.env.MICROCITY_FAKE_AI_PORT ?? 8799)

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    messages?: { role?: string; content?: string }[]
  }
  const system = body.messages?.[0]?.content ?? ''
  const user = body.messages?.[1]?.content ?? ''
  const factsMarker = 'COMPUTED FACTS (JSON):'
  const factsStart = user.lastIndexOf(factsMarker)
  let facts: Record<string, unknown> = {}
  if (factsStart >= 0) {
    try {
      facts = JSON.parse(user.slice(factsStart + factsMarker.length).trim()) as Record<string, unknown>
    } catch {
      facts = {}
    }
  }

  let content = 'The recorded evidence is available for review.'
  if (system.includes('explain one finding')) {
    content =
      facts.findingId === 'capacity-rm-bv-101'
        ? 'This finding affects 987654321 people according to the supplied evidence.'
        : 'The recorded evidence supports reviewing this finding. Check the listed records before deciding what to do.'
  } else if (system.includes('five-line plain-language')) {
    content = [
      'The reported gaps are listed for review.',
      'Open reports remain visible to the college.',
      'Recorded resource readings need review.',
      'Maintenance work follows the recorded queue.',
      'Plan options and decisions remain unchanged.',
    ].join('\n')
  } else if (system.includes('suggest a classification')) {
    const rooms = Array.isArray(facts.rooms) ? facts.rooms as { id?: string }[] : []
    content = JSON.stringify({
      category: 'IT / network',
      room: rooms[0]?.id ?? null,
      severity: 'high',
    })
  } else if (system.includes('ONE lookup id')) {
    content = JSON.stringify({
      lookupId: /population|enrollment across years/i.test(user) ? null : 'rooms-over-capacity',
    })
  }

  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content } }] }))
})

server.listen(port, '127.0.0.1')
