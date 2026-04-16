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

  const { swLat, swLng, neLat, neLng, centerLat, centerLng, sido = '서울' } = req.query
  if (!swLat || !swLng || !neLat || !neLng) {
    return res.status(400).json({ error: 'swLat, swLng, neLat, neLng 파라미터가 필요해요' })
  }

  const sw = { lat: parseFloat(swLat), lng: parseFloat(swLng) }
  const ne = { lat: parseFloat(neLat), lng: parseFloat(neLng) }
  const cLat = centerLat ? parseFloat(centerLat) : (sw.lat + ne.lat) / 2
  const cLng = centerLng ? parseFloat(centerLng) : (sw.lng + ne.lng) / 2

  try {
    const url = `https://apis.data.go.kr/1741000/public_restroom_info/info?serviceKey=${SERVICE_KEY}&pageNo=1&numOfRows=3000&type=json&sido=${encodeURIComponent(sido)}`
    const response = await fetch(url)

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`API ${response.status}: ${body.slice(0, 300)}`)
    }

    const data = await response.json()
    const items = data?.response?.body?.items?.item || data?.items || []

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(200).json({ restrooms: [], debugRaw: JSON.stringify(data).slice(0, 1000) })
    }

    // 기저귀교환대 있는 곳만 필터링 + 지도 bounds 안에 있는 것만
    const results = items
      .filter(item => item.DIAP_EXCHCON_EN === 'Y')
      .map(item => {
        const itemLat = parseFloat(item.WGS84_LAT || 0)
        const itemLng = parseFloat(item.WGS84_LOT || 0)
        if (itemLat === 0 || itemLng === 0) return null
        if (itemLat < sw.lat || itemLat > ne.lat || itemLng < sw.lng || itemLng > ne.lng) return null
        const distance = getDistance(cLat, cLng, itemLat, itemLng)
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
      .filter(Boolean)
      .sort((a, b) => a._distance - b._distance)

    res.status(200).json({ restrooms: results, total: results.length })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
