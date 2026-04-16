const SERVICE_KEY = '5cbb5138262218476992f1c4142072e454c4a3507d0f7ff672242e19b2b04298'

// Haversine 공식으로 두 좌표 간 거리 계산 (미터)
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { lat, lng, sido = '서울' } = req.query
  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat, lng 파라미터가 필요해요' })
  }

  try {
    const url = `https://apis.data.go.kr/1741000/public_restroom_info/info?serviceKey=${encodeURIComponent(SERVICE_KEY)}&pageNo=1&numOfRows=1000&type=json&sido=${encodeURIComponent(sido)}`
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`API 응답 오류: ${response.status}`)
    }

    const data = await response.json()

    // 응답 구조 파악
    const items = data?.response?.body?.items?.item || data?.items || []

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ restrooms: [], debug: JSON.stringify(data).slice(0, 500) })
    }

    const userLat = parseFloat(lat)
    const userLng = parseFloat(lng)
    const RADIUS = 2000 // 2km

    // 기저귀교환대 있는 곳만 필터링 + 거리 계산
    const results = items
      .filter(item => {
        const hasChanger =
          item.babyYn === 'Y' || item.diaperYn === 'Y' ||
          item.babyroomYn === 'Y' || item.changeYn === 'Y' ||
          item.diaper_yn === 'Y' || item.baby_yn === 'Y' ||
          (item.etcFacility && item.etcFacility.includes('기저귀'))
        return hasChanger
      })
      .map(item => {
        const itemLat = parseFloat(item.wgsY || item.latitude || item.lat || 0)
        const itemLng = parseFloat(item.wgsX || item.longitude || item.lng || 0)
        const distance = getDistance(userLat, userLng, itemLat, itemLng)
        return { ...item, _distance: Math.round(distance), _lat: itemLat, _lng: itemLng }
      })
      .filter(item => item._distance <= RADIUS && item._lat !== 0)
      .sort((a, b) => a._distance - b._distance)
      .slice(0, 30)

    res.status(200).json({ restrooms: results, total: results.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
