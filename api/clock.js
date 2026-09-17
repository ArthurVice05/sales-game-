export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('allow', 'GET, HEAD')
    return res.status(405).end()
  }

  res.setHeader('Cache-Control', 'no-store, max-age=0')
  res.setHeader('CDN-Cache-Control', 'no-store')
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store')
  if (req.method === 'HEAD') return res.status(204).end()
  return res.status(200).json({ now: Date.now() })
}
