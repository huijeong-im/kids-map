import { useState, useEffect, useRef } from 'react'

const CATEGORIES = [
  { key: '기저귀교환대', label: '기저귀교환대', emoji: '🚼' },
  { key: '수유실', label: '수유실', emoji: '🍼' },
  { key: '공원', label: '공원', emoji: '🌳' },
  { key: '놀이터', label: '놀이터', emoji: '🛝' },
  { key: '키즈카페', label: '키즈카페', emoji: '🎠' },
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

// 도보(80m/min), 차(500m/min≈30km/h)
function formatTime(distM) {
  const walk = Math.ceil(distM / 80)
  const drive = Math.ceil(distM / 500)
  const walkStr = walk >= 60 ? `${Math.floor(walk/60)}시간 ${walk%60 ? walk%60+'분' : ''}`.trim() : `${walk}분`
  const driveStr = drive < 1 ? '1분 미만' : `${drive}분`
  return { walk: `🚶 ${walkStr}`, drive: `🚗 ${driveStr}` }
}

export default function App() {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const overlaysRef = useRef([])
  const categoryRef = useRef('기저귀교환대')

  const [category, setCategory] = useState('기저귀교환대')
  const [places, setPlaces] = useState([])
  const [loading, setLoading] = useState(true)
  const [locError, setLocError] = useState(null)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const myLocationRef = useRef(null)

  const [ratings, setRatings] = useState(() => {
    const s = localStorage.getItem('place-ratings')
    return s ? JSON.parse(s) : {}
  })
  const [comments, setComments] = useState(() => {
    const s = localStorage.getItem('place-comments')
    return s ? JSON.parse(s) : {}
  })
  const [editingComment, setEditingComment] = useState('')
  const [savedMsg, setSavedMsg] = useState(false)

  const rate = (placeId, value) => {
    const next = { ...ratings }
    if (next[placeId] === value) delete next[placeId]
    else next[placeId] = value
    setRatings(next)
    localStorage.setItem('place-ratings', JSON.stringify(next))
  }

  const saveComment = (placeId) => {
    const next = { ...comments, [placeId]: { text: editingComment, updatedAt: new Date().toISOString() } }
    if (!editingComment.trim()) delete next[placeId]
    setComments(next)
    localStorage.setItem('place-comments', JSON.stringify(next))
    setSavedMsg(true)
    setTimeout(() => setSavedMsg(false), 2000)
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

  useEffect(() => {
    categoryRef.current = category
    if (mapInstanceRef.current) searchByBounds(category)
  }, [category])

  // 장소 선택시 기존 한줄평 불러오기
  useEffect(() => {
    if (selectedPlace) {
      setEditingComment(comments[selectedPlace.id]?.text || '')
    }
  }, [selectedPlace?.id])

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
        myLocationRef.current = { lat, lng }

        const map = mapInstanceRef.current
        const coords = new kakao.maps.LatLng(lat, lng)
        map.setCenter(coords)
        map.setLevel(5)

        const dot = document.createElement('div')
        dot.style.cssText = 'width:14px;height:14px;background:#FF6B9D;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3)'
        new kakao.maps.CustomOverlay({ map, position: coords, content: dot, yAnchor: 0.5 })
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
      fetch(`/api/restrooms?lat=${center.getLat()}&lng=${center.getLng()}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error)
          const myLoc = myLocationRef.current
          const items = (data.restrooms || []).map(item => ({
            id: item.managementCode || item.restroomNm + item._lat,
            place_name: item.restroomNm || '공중화장실',
            road_address_name: item.rdnmadr || '',
            address_name: item.rdnmadr || '',
            x: String(item._lng), y: String(item._lat),
            distance: myLoc ? String(calcDist(myLoc.lat, myLoc.lng, item._lat, item._lng)) : String(item._distance),
            place_url: '', phone: item.phoneNumber || '',
            _kw: '기저귀교환대',
          }))
          items.sort((a, b) => Number(a.distance) - Number(b.distance))
          setPlaces(items)
          addOverlays(items)
          setLoading(false)
        })
        .catch(e => { setLocError('기저귀교환대 오류: ' + e.message); setLoading(false) })
      return
    }

    const bounds = map.getBounds()
    const ps = new kakao.maps.services.Places()
    const keywords = [cat]
    const allResults = []
    let doneCount = 0

    keywords.forEach((kw) => {
      ps.keywordSearch(kw, (data, status) => {
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
      }, { bounds, sort: kakao.maps.services.SortBy.ACCURACY })
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
      const name = place.place_name.length > 9 ? place.place_name.slice(0, 9) + '…' : place.place_name
      const div = document.createElement('div')
      div.style.cssText = `background:white;border:2px solid ${color};border-radius:20px;padding:4px 10px;font-size:12px;font-weight:700;color:#333;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.15);cursor:pointer;font-family:-apple-system,BlinkMacSystemFont,sans-serif;`
      div.textContent = `${getEmoji(place._kw)} ${name}`
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

  const formatCommentDate = (iso) => {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')} 수정`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#F8F9FF' }}>

      {/* 헤더 */}
      <div style={{ background: 'linear-gradient(135deg, #FF6B9D 0%, #FF8FAB 100%)', padding: '14px 20px 14px', paddingTop: 'max(14px, env(safe-area-inset-top))', flexShrink: 0 }}>
        <div style={{ fontSize: '22px', fontWeight: '800', color: 'white' }}>🗺️ 민서야 사랑해</div>
      </div>

      {/* 카테고리 탭 */}
      <div style={{ display: 'flex', gap: '8px', padding: '10px 16px', background: 'white', borderBottom: '1px solid #EEF0FF', flexShrink: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {CATEGORIES.map(c => (
          <button key={c.key} onClick={() => setCategory(c.key)}
            style={{ padding: '8px 14px', borderRadius: '99px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '700', whiteSpace: 'nowrap', background: category === c.key ? '#FF6B9D' : '#F0F4FF', color: category === c.key ? 'white' : '#555', flexShrink: 0 }}>
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {/* 지도 */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

        {loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
            <div style={{ fontSize: '44px', marginBottom: '10px' }}>🔍</div>
            <div style={{ fontSize: '15px', color: '#666', fontWeight: '600' }}>장소 찾는 중...</div>
          </div>
        )}

        {locError && !loading && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.97)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10, padding: '32px' }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>📍</div>
            <div style={{ fontSize: '15px', color: '#555', textAlign: 'center', marginBottom: '24px', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{locError}</div>
            <button onClick={getCurrentLocation} style={{ padding: '14px 32px', borderRadius: '99px', border: 'none', background: '#FF6B9D', color: 'white', fontWeight: '700', fontSize: '16px', cursor: 'pointer' }}>다시 시도</button>
          </div>
        )}

        {!loading && !locError && (
          <button onClick={getCurrentLocation}
            style={{ position: 'absolute', top: 12, right: 12, zIndex: 5, width: '44px', height: '44px', borderRadius: '50%', border: 'none', background: 'white', boxShadow: '0 2px 10px rgba(0,0,0,0.2)', fontSize: '20px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            📍
          </button>
        )}

        {/* 장소 상세 카드 (바텀시트) */}
        {selectedPlace && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'white', borderRadius: '20px 20px 0 0', padding: '16px 20px 20px', paddingBottom: 'max(20px, env(safe-area-inset-bottom))', boxShadow: '0 -4px 24px rgba(0,0,0,0.12)', zIndex: 10, maxHeight: '75vh', overflowY: 'auto' }}>
            <div style={{ width: '36px', height: '4px', background: '#eee', borderRadius: '99px', margin: '0 auto 16px' }} />

            {/* 이름 + 닫기 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '17px', fontWeight: '800', color: '#1A1A2E', marginBottom: '5px', lineHeight: 1.3 }}>
                  {getEmoji(selectedPlace._kw)} {selectedPlace.place_name}
                </div>
                <div style={{ fontSize: '13px', color: '#888', marginBottom: '4px' }}>📍 {selectedPlace.road_address_name || selectedPlace.address_name}</div>
                {/* 도보 + 차 시간 */}
                <div style={{ display: 'flex', gap: '10px' }}>
                  <span style={{ fontSize: '13px', color: '#555', fontWeight: '600' }}>{formatTime(Number(selectedPlace.distance)).walk}</span>
                  <span style={{ fontSize: '13px', color: '#888' }}>{formatTime(Number(selectedPlace.distance)).drive}</span>
                </div>
              </div>
              <button onClick={() => setSelectedPlace(null)} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#ccc', padding: '0 0 0 12px', lineHeight: 1 }}>✕</button>
            </div>

            {/* 평가 + 액션 버튼 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button onClick={() => rate(selectedPlace.id, 'good')}
                style={{ width: '52px', height: '48px', borderRadius: '14px', border: '2px solid', borderColor: ratings[selectedPlace.id] === 'good' ? '#40C057' : '#eee', background: ratings[selectedPlace.id] === 'good' ? '#EBFBEE' : 'white', fontSize: '22px', cursor: 'pointer', flexShrink: 0 }}>
                👍
              </button>
              <button onClick={() => rate(selectedPlace.id, 'bad')}
                style={{ width: '52px', height: '48px', borderRadius: '14px', border: '2px solid', borderColor: ratings[selectedPlace.id] === 'bad' ? '#FA5252' : '#eee', background: ratings[selectedPlace.id] === 'bad' ? '#FFF5F5' : 'white', fontSize: '22px', cursor: 'pointer', flexShrink: 0 }}>
                👎
              </button>
              {selectedPlace.phone && (
                <a href={`tel:${selectedPlace.phone}`} style={{ flex: 1, height: '48px', borderRadius: '14px', background: '#F0F4FF', color: '#3B5BDB', fontWeight: '700', fontSize: '14px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>📞 전화</a>
              )}
              {selectedPlace.place_url && (
                <a href={selectedPlace.place_url} target="_blank" rel="noreferrer"
                  style={{ flex: 2, height: '48px', borderRadius: '14px', background: 'linear-gradient(135deg, #FF6B9D, #FF8FAB)', color: 'white', fontWeight: '700', fontSize: '14px', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  카카오맵 →
                </a>
              )}
            </div>

            {/* 한줄평 */}
            <div style={{ background: '#F8F9FF', borderRadius: '14px', padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#555' }}>📝 한줄평</div>
                {comments[selectedPlace.id]?.updatedAt && (
                  <div style={{ fontSize: '11px', color: '#bbb' }}>{formatCommentDate(comments[selectedPlace.id].updatedAt)}</div>
                )}
              </div>
              <textarea
                value={editingComment}
                onChange={e => setEditingComment(e.target.value)}
                placeholder="이곳은 어땠나요? 메모를 남겨보세요"
                style={{ width: '100%', minHeight: '64px', border: '1px solid #E8E8F0', borderRadius: '10px', padding: '10px', fontSize: '14px', resize: 'none', outline: 'none', fontFamily: 'inherit', background: 'white', color: '#333', boxSizing: 'border-box' }}
              />
              <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={() => saveComment(selectedPlace.id)}
                  style={{ flex: 1, padding: '10px', borderRadius: '10px', border: 'none', background: '#FF6B9D', color: 'white', fontWeight: '700', fontSize: '14px', cursor: 'pointer' }}>
                  저장
                </button>
                {savedMsg && (
                  <span style={{ fontSize: '13px', color: '#40C057', fontWeight: '600', whiteSpace: 'nowrap' }}>✓ 저장됐어요!</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 하단 목록 */}
      {places.length > 0 && !selectedPlace && !loading && (
        <div style={{ flexShrink: 0, maxHeight: '230px', overflowY: 'auto', background: 'white', borderTop: '1px solid #EEF0FF', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ padding: '10px 16px 4px', fontSize: '12px', color: '#aaa', fontWeight: '700' }}>
            {places.length}곳 발견 · 가까운 순
          </div>
          {places.map((place) => {
            const times = formatTime(Number(place.distance))
            const rating = ratings[place.id]
            const comment = comments[place.id]
            return (
              <div key={place.id} onClick={() => goToPlace(place)}
                style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 16px', borderBottom: '1px solid #F5F5F5', cursor: 'pointer' }}>
                <div style={{ fontSize: '24px', flexShrink: 0 }}>{getEmoji(place._kw)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#1A1A2E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.place_name}</div>
                    {rating && <span style={{ fontSize: '16px', flexShrink: 0 }}>{rating === 'good' ? '👍' : '👎'}</span>}
                  </div>
                  {comment?.text ? (
                    <div style={{ fontSize: '12px', color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>💬 {comment.text}</div>
                  ) : (
                    <div style={{ fontSize: '12px', color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.road_address_name || place.address_name}</div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px', flexShrink: 0 }}>
                  <div style={{ fontSize: '12px', color: '#555', fontWeight: '600' }}>{times.walk}</div>
                  <div style={{ fontSize: '11px', color: '#aaa' }}>{times.drive}</div>
                </div>
              </div>
            )
          })}
          <div style={{ height: 'env(safe-area-inset-bottom)' }} />
        </div>
      )}

      {!loading && !locError && places.length === 0 && category === '기저귀교환대' && (
        <div style={{ padding: '20px', textAlign: 'center', fontSize: '14px', color: '#aaa', background: 'white', borderTop: '1px solid #EEF0FF' }}>
          🚼 이 지역 기저귀교환대 데이터가 없어요
        </div>
      )}
    </div>
  )
}
