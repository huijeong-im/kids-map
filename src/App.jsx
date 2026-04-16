import { useState, useEffect, useRef, useCallback } from 'react'

const CATEGORIES = [
  { key: 'all', label: '전체', emoji: '🗺️' },
  { key: '키즈카페', label: '키즈카페', emoji: '🎠' },
  { key: '놀이터', label: '놀이터', emoji: '🛝' },
  { key: '공원', label: '공원', emoji: '🌳' },
  { key: '수유실', label: '수유실', emoji: '🍼' },
  { key: '기저귀교환대', label: '기저귀교환대', emoji: '🚼' },
]

const MARKER_COLORS = {
  '키즈카페': '#FF6B9D',
  '놀이터': '#5C7CFA',
  '공원': '#40C057',
  '수유실': '#FF922B',
  '기저귀교환대': '#9775FA',
}

const getEmoji = (kw) =>
  kw === '키즈카페' ? '🎠' : kw === '공원' ? '🌳' : kw === '수유실' ? '🍼' : kw === '기저귀교환대' ? '🚼' : '🛝'

function calcDist(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const overlaysRef = useRef([])
  const categoryRef = useRef('all')

  const [category, setCategory] = useState('all')
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [locError, setLocError] = useState(null)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [myLocation, setMyLocation] = useState(null)
  const myLocationRef = useRef(null)
  const [ratings, setRatings] = useState(() => {
    const s = localStorage.getItem('place-ratings')
    return s ? JSON.parse(s) : {}
  })

  const rate = (placeId, value) => {
    const next = { ...ratings }
    if (next[placeId] === value) {
      delete next[placeId] // 같은 버튼 다시 누르면 취소
    } else {
      next[placeId] = value
    }
    setRatings(next)
    localStorage.setItem('place-ratings', JSON.stringify(next))
  }

  // 지도 초기화
  useEffect(() => {
    const init = () => {
      try {
        const container = mapRef.current
        mapInstanceRef.current = new kakao.maps.Map(container, {
          center: new kakao.maps.LatLng(37.5665, 126.9780),
          level: 5,
        })
        // 지도 이동/확대 끝나면 자동 재검색
        kakao.maps.event.addListener(mapInstanceRef.current, 'idle', () => {
          searchByBounds(categoryRef.current)
        })
        getCurrentLocation()
      } catch (e) {
        setLocError('지도 초기화 오류: ' + e.message)
        setLoading(false)
      }
    }

    const script = document.createElement('script')
    script.src = 'https://dapi.kakao.com/v2/maps/sdk.js?appkey=f6fb3013ac0783edfdacee69ee48826f&libraries=services&autoload=false'
    script.onload = () => window.kakao.maps.load(init)
    script.onerror = () => {
      setLocError('카카오맵 SDK 로드 실패.\n네트워크 또는 API 키 설정을 확인해주세요.')
      setLoading(false)
    }
    document.head.appendChild(script)
    return () => { if (script.parentNode) script.parentNode.removeChild(script) }
  }, [])

  // 카테고리 변경 시 재검색
  useEffect(() => {
    categoryRef.current = category
    if (mapInstanceRef.current) {
      searchByBounds(category)
    }
  }, [category])

  const getCurrentLocation = () => {
    setLoading(true)
    setLocError(null)
    if (!navigator.geolocation) {
      setLocError('이 브라우저는 위치 정보를 지원하지 않아요')
      setLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude
        const lng = pos.coords.longitude
        setMyLocation({ lat, lng })
        myLocationRef.current = { lat, lng }

        const map = mapInstanceRef.current
        const coords = new kakao.maps.LatLng(lat, lng)
        map.setCenter(coords)
        map.setLevel(5)

        // 내 위치 마커
        const dot = document.createElement('div')
        dot.style.cssText = 'width:14px;height:14px;background:#FF6B9D;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)'
        new kakao.maps.CustomOverlay({ map, position: coords, content: dot, yAnchor: 0.5 })
        // idle 이벤트가 자동으로 searchByBounds 호출
      },
      () => {
        setLocError('위치 정보를 가져올 수 없어요.\n브라우저에서 위치 권한을 허용해주세요.')
        setLoading(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const searchByBounds = (cat) => {
    const map = mapInstanceRef.current
    if (!map) return
    setLoading(true)
    setSelectedPlace(null)
    clearOverlays()

    if (cat === '기저귀교환대') {
      const center = map.getCenter()
      const lat = center.getLat()
      const lng = center.getLng()
      fetch(`/api/restrooms?lat=${lat}&lng=${lng}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error)
          const myLoc = myLocationRef.current
          const items = (data.restrooms || []).map(item => ({
            id: item.managementCode || item.restroomNm + item._lat,
            place_name: item.restroomNm || '공중화장실',
            road_address_name: item.rdnmadr || item.lnmadr || '',
            address_name: item.lnmadr || item.rdnmadr || '',
            x: String(item._lng),
            y: String(item._lat),
            distance: myLoc ? String(calcDist(myLoc.lat, myLoc.lng, item._lat, item._lng)) : String(item._distance),
            place_url: '',
            phone: item.phoneNumber || '',
            _kw: '기저귀교환대',
          }))
          items.sort((a, b) => Number(a.distance) - Number(b.distance))
          setPlaces(items)
          addOverlays(items)
          setLoading(false)
        })
        .catch(e => {
          setLocError('기저귀교환대 오류: ' + e.message)
          setLoading(false)
        })
      return
    }

    const bounds = map.getBounds()
    const ps = new kakao.maps.services.Places()
    const keywords = cat === 'all' ? ['키즈카페', '놀이터', '공원', '수유실'] : [cat]
    const allResults = []
    let doneCount = 0

    keywords.forEach((kw) => {
      ps.keywordSearch(
        kw,
        (data, status) => {
          if (status === kakao.maps.services.Status.OK) {
            allResults.push(...data.map(d => ({ ...d, _kw: kw })))
          }
          doneCount++
          if (doneCount === keywords.length) {
            const seen = new Set()
            const unique = allResults.filter(p => {
              if (seen.has(p.id)) return false
              seen.add(p.id)
              return true
            })
            // 내 위치 기준 거리 재계산
            const myLoc = myLocationRef.current
            if (myLoc) {
              unique.forEach(p => {
                p.distance = String(calcDist(myLoc.lat, myLoc.lng, parseFloat(p.y), parseFloat(p.x)))
              })
            }
            unique.sort((a, b) => Number(a.distance) - Number(b.distance))
            setPlaces(unique)
            addOverlays(unique)
            setLoading(false)
          }
        },
        { bounds, sort: kakao.maps.services.SortBy.ACCURACY }
      )
    })
  }

  const clearOverlays = () => {
    overlaysRef.current.forEach(o => o.setMap(null))
    overlaysRef.current = []
  }

  const addOverlays = (placeList) => {
    const map = mapInstanceRef.current
    if (!map) return
    placeList.forEach((place) => {
      const pos = new kakao.maps.LatLng(place.y, place.x)
      const color = MARKER_COLORS[place._kw] || '#5C7CFA'
      const emoji = getEmoji(place._kw)
      const name = place.place_name.length > 9 ? place.place_name.slice(0, 9) + '…' : place.place_name

      const div = document.createElement('div')
      div.style.cssText = `background:white;border:2px solid ${color};border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.15);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;`
      div.textContent = `${emoji} ${name}`
      div.addEventListener('click', () => { setSelectedPlace(place); map.panTo(pos) })

      const overlay = new kakao.maps.CustomOverlay({ position: pos, content: div, yAnchor: 1.4 })
      overlay.setMap(map)
      overlaysRef.current.push(overlay)
    })
  }

  const goToPlace = (place) => {
    const map = mapInstanceRef.current
    if (!map) return
    map.panTo(new kakao.maps.LatLng(place.y, place.x))
    map.setLevel(3)
    setSelectedPlace(place)
  }

  const formatDist = (d) =>
    Number(d) >= 1000 ? (Number(d) / 1000).toFixed(1) + 'km' : Number(d) + 'm'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#F8F9FF' }}>

      {/* 헤더 */}
      <div style={{ background: 'linear-gradient(135deg, #FF6B9D 0%, #FF8FAB 100%)', padding: '16px 20px 12px', flexShrink: 0 }}>
        <div style={{ fontSize: '20px', fontWeight: '800', color: 'white', marginBottom: '2px' }}>🗺️ 민서맘 놀이터 지도</div>
        <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.85)' }}>지도 범위 내 장소 · 거리순 정렬</div>
      </div>

      {/* 카테고리 탭 */}
      <div style={{ display: 'flex', gap: '8px', padding: '10px 16px', background: 'white', borderBottom: '1px solid #EEF0FF', flexShrink: 0, overflowX: 'auto' }}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            style={{ padding: '7px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', whiteSpace: 'nowrap', background: category === c.key ? '#FF6B9D' : '#F0F4FF', color: category === c.key ? 'white' : '#555' }}>
            {c.emoji} {c.label}
          </button>
        ))}
        <button onClick={getCurrentLocation}
          style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', background: '#EEF0FF', color: '#3B5BDB', whiteSpace: 'nowrap', flexShrink: 0 }}>
          📍 내 위치
        </button>
      </div>

      {/* 지도 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <div style={{ fontSize: '40px', marginBottom: '10px' }}>🔍</div>
            <div style={{ fontSize: '14px', color: '#666', fontWeight: '600' }}>장소 찾는 중...</div>
          </div>
        )}

        {locError && !loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.95)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '32px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📍</div>
            <div style={{ fontSize: '14px', color: '#555', textAlign: 'center', marginBottom: '20px', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{locError}</div>
            <button onClick={getCurrentLocation} style={{ padding: '12px 28px', borderRadius: '99px', border: 'none', background: '#FF6B9D', color: 'white', fontWeight: '700', fontSize: '15px', cursor: 'pointer' }}>
              다시 시도
            </button>
          </div>
        )}

        {!loading && !locError && (
          <button onClick={getCurrentLocation}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 5, width: '40px', height: '40px', borderRadius: '50%', border: 'none', background: 'white', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', fontSize: '18px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            📍
          </button>
        )}

        {selectedPlace && (
          <div style={{ position: 'absolute', bottom: 16, left: 16, right: 16, background: 'white', borderRadius: '20px', padding: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.18)', zIndex: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '16px', fontWeight: '800', color: '#1A1A2E', marginBottom: '5px' }}>
                  {getEmoji(selectedPlace._kw)} {selectedPlace.place_name}
                </div>
                <div style={{ fontSize: '12px', color: '#888', marginBottom: '3px' }}>📍 {selectedPlace.road_address_name || selectedPlace.address_name}</div>
                <div style={{ fontSize: '12px', color: '#FF6B9D', fontWeight: '700' }}>🚶 {formatDist(selectedPlace.distance)}</div>
              </div>
              <button onClick={() => setSelectedPlace(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#ccc', padding: '0 0 0 12px' }}>✕</button>
            </div>
            {/* 평가 버튼 */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', marginBottom: '8px' }}>
              <button
                onClick={() => rate(selectedPlace.id, 'good')}
                style={{ flex: 1, padding: '8px', borderRadius: '12px', border: '2px solid', borderColor: ratings[selectedPlace.id] === 'good' ? '#40C057' : '#eee', background: ratings[selectedPlace.id] === 'good' ? '#EBFBEE' : 'white', fontSize: '18px', cursor: 'pointer', fontWeight: '700' }}>
                👍 좋아요
              </button>
              <button
                onClick={() => rate(selectedPlace.id, 'bad')}
                style={{ flex: 1, padding: '8px', borderRadius: '12px', border: '2px solid', borderColor: ratings[selectedPlace.id] === 'bad' ? '#FA5252' : '#eee', background: ratings[selectedPlace.id] === 'bad' ? '#FFF5F5' : 'white', fontSize: '18px', cursor: 'pointer', fontWeight: '700' }}>
                👎 별로예요
              </button>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              {selectedPlace.phone && (
                <a href={`tel:${selectedPlace.phone}`} style={{ flex: 1, padding: '10px', borderRadius: '12px', background: '#F0F4FF', color: '#3B5BDB', fontWeight: '700', fontSize: '13px', textDecoration: 'none', textAlign: 'center' }}>📞 전화</a>
              )}
              {selectedPlace.place_url && (
                <a href={selectedPlace.place_url} target="_blank" rel="noreferrer"
                  style={{ flex: 2, padding: '10px', borderRadius: '12px', background: 'linear-gradient(135deg, #FF6B9D, #FF8FAB)', color: 'white', fontWeight: '700', fontSize: '13px', textDecoration: 'none', textAlign: 'center' }}>
                  카카오맵에서 보기 →
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 하단 목록 */}
      {places.length > 0 && !selectedPlace && !loading && (
        <div style={{ flexShrink: 0, maxHeight: '200px', overflowY: 'auto', background: 'white', borderTop: '1px solid #EEF0FF' }}>
          <div style={{ padding: '8px 16px 4px', fontSize: '11px', color: '#aaa', fontWeight: '700' }}>
            {places.length}곳 발견 · 가까운 순
          </div>
          {places.map((place) => (
            <div key={place.id} onClick={() => goToPlace(place)}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 16px', borderBottom: '1px solid #F8F8F8', cursor: 'pointer' }}>
              <div style={{ fontSize: '22px', flexShrink: 0 }}>{getEmoji(place._kw)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#1A1A2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.place_name}</div>
                <div style={{ fontSize: '11px', color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.road_address_name || place.address_name}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                <div style={{ fontSize: '12px', color: '#FF6B9D', fontWeight: '700' }}>{formatDist(place.distance)}</div>
                {ratings[place.id] && (
                  <div style={{ fontSize: '14px' }}>{ratings[place.id] === 'good' ? '👍' : '👎'}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !locError && places.length === 0 && category === '기저귀교환대' && (
        <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: '#aaa', background: 'white', borderTop: '1px solid #EEF0FF' }}>
          🚼 이 지역 기저귀교환대 데이터가 없어요
        </div>
      )}
    </div>
  )
}
