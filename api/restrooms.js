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
    const url = `https://apis.data.go.kr/1741000/public_restroom_info/info?serviceKey=${SERVICE_KEY}&pageNo=1&numOfRows=1000&type=json&sido=${encodeURIComponent(sido)}`
    const response = await fetch(url)

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`API ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = await response.json()

    // 응답 구조 파악
    const items = data?.response?.body?.items?.item || data?.items || []

    if (!Array.isArray(items) || items.length === 0) {
      // 응답 구조 그대로 반환해서 필드명 확인
      return res.status(200).json({ restrooms: [], debugRaw: JSON.stringify(data).slice(0, 1000) })
    }

    // 첫 번째 아이템의 키 목록 반환 (필드명 확인용)
    const sampleKeys = Object.keys(items[0])

    const userLat = parseFloat(lat)
    const userLng = parseFloat(lng)
    const RADIUS = 2000 // 2km

    // 기저귀교환대 있는 곳만 필터링 + 거리 계산
    const results = items
      .filter(item => item.DIAP_EXCHCON_EN === 'Y')
      .map(item => {
        const itemLat = parseFloat(item.WGS84_LAT || 0)
        const itemLng = parseFloat(item.WGS84_LOT || 0)
        const distance = getDistance(userLat, userLng, itemLat, itemLng)
        const openTime = item.OPEN_TM || item.OPER_BEGIN_TM || ''
        const closeTime = item.CLOSE_TM || item.OPER_END_TM || ''
        const operTime = openTime && closeTime ? `${openTime} ~ ${closeTime}` : (item.OPER_TM || item.OPER_TIME || '')
        return {
          managementCode: item.MNG_NO,
          restroomNm: item.SE_NM || item.MNG_INST_NM || '공중화장실',
          rdnmadr: item.LCTN_ROAD_NM_ADDR || item.LCTN_LOTNO_ADDR || '',
          phoneNumber: item.TELNO || '',
          operTime: operTime.trim(),
          _distance: Math.round(distance),
          _lat: itemLat,
          _lng: itemLng,
        }
      })
      .filter(item => item._distance <= RADIUS && item._lat !== 0)
      .sort((a, b) => a._distance - b._distance)
      .slice(0, 30)

    res.status(200).json({
      restrooms: results,
      total: results.length,
      sampleKeys, // 필드명 확인용
      totalItems: items.length, // 전체 건수
      sample: items[0], // 첫 번째 항목 원본
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
