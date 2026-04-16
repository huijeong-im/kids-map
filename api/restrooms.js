const SERVICE_KEY = '5cbb5138262218476992f1c4142072e454c4a3507d0f7ff672242e19b2b04298'

function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng/2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// 각 시/도의 대략적인 경계 박스
const SIDO_BOUNDS = [
  { name: '서울',  swLat: 37.42, swLng: 126.76, neLat: 37.70, neLng: 127.18 },
  { name: '경기',  swLat: 36.95, swLng: 126.40, neLat: 38.30, neLng: 127.85 },
  { name: '인천',  swLat: 37.10, swLng: 126.10, neLat: 37.65, neLng: 126.85 },
  { name: '강원',  swLat: 37.00, swLng: 127.70, neLat: 38.65, neLng: 129.40 },
  { name: '충북',  swLat: 36.30, swLng: 127.60, neLat: 37.10, neLng: 128.55 },
  { name: '충남',  swLat: 35.90, swLng: 126.30, neLat: 37.00, neLng: 127.60 },
  { name: '세종',  swLat: 36.40, swLng: 127.20, neLat: 36.75, neLng: 127.40 },
  { name: '대전',  swLat: 36.20, swLng: 127.30, neLat: 36.50, neLng: 127.60 },
  { name: '전북',  swLat: 35.40, swLng: 126.40, neLat: 35.95, neLng: 127.80 },
  { name: '광주',  swLat: 35.05, swLng: 126.75, neLat: 35.30, neLng: 127.00 },
  { name: '전남',  swLat: 34.20, swLng: 126.10, neLat: 35.50, neLng: 127.80 },
  { name: '경북',  swLat: 35.60, swLng: 128.00, neLat: 37.00, neLng: 129.50 },
  { name: '대구',  swLat: 35.65, swLng: 128.35, neLat: 36.00, neLng: 128.80 },
  { name: '경남',  swLat: 34.70, swLng: 127.60, neLat: 35.60, neLng: 129.30 },
  { name: '울산',  swLat: 35.40, swLng: 129.00, neLat: 35.65, neLng: 129.40 },
  { name: '부산',  swLat: 34.90, swLng: 128.75, neLat: 35.40, neLng: 129.35 },
  { name: '제주',  swLat: 33.10, swLng: 126.10, neLat: 33.60, neLng: 126.95 },
]

// 지도 bounds와 겹치는 모든 시/도 반환
function getOverlappingSido(sw, ne) {
  return SIDO_BOUNDS
    .filter(s =>
      !(s.neLat < sw.lat || s.swLat > ne.lat || s.neLng < sw.lng || s.swLng > ne.lng)
    )
    .map(s => s.name)
}

async function fetchSido(sido) {
  const url = `https://apis.data.go.kr/1741000/public_restroom_info/info?serviceKey=${SERVICE_KEY}&pageNo=1&numOfRows=3000&type=json&sido=${encodeURIComponent(sido)}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = await res.json()
  const items = data?.response?.body?.items?.item || data?.items || []
  return Array.isArray(items) ? items : []
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')

  const { swLat, swLng, neLat, neLng, centerLat, centerLng } = req.query
  if (!swLat || !swLng || !neLat || !neLng) {
    return res.status(400).json({ error: 'swLat, swLng, neLat, neLng 파라미터가 필요해요' })
  }

  const sw = { lat: parseFloat(swLat), lng: parseFloat(swLng) }
  const ne = { lat: parseFloat(neLat), lng: parseFloat(neLng) }
  const cLat = centerLat ? parseFloat(centerLat) : (sw.lat + ne.lat) / 2
  const cLng = centerLng ? parseFloat(centerLng) : (sw.lng + ne.lng) / 2

  const sidoList = getOverlappingSido(sw, ne)
  if (sidoList.length === 0) {
    return res.status(200).json({ restrooms: [], total: 0 })
  }

  try {
    // 겹치는 모든 시/도 병렬 요청
    const allItems = (await Promise.all(sidoList.map(fetchSido))).flat()

    const seen = new Set()
    const results = allItems
      .filter(item => item.DIAP_EXCHCON_EN === 'Y')
      .map(item => {
        const itemLat = parseFloat(item.WGS84_LAT || 0)
        const itemLng = parseFloat(item.WGS84_LOT || 0)
        if (itemLat === 0 || itemLng === 0) return null
        if (itemLat < sw.lat || itemLat > ne.lat || itemLng < sw.lng || itemLng > ne.lng) return null
        const key = item.MNG_NO || `${itemLat},${itemLng}`
        if (seen.has(key)) return null
        seen.add(key)
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

    res.status(200).json({ restrooms: results, total: results.length, sido: sidoList })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
