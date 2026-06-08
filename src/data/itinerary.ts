export type ItineraryEvent = {
  time?: string;
  title: string;
  description?: string;
  location?: string;
  note?: string;
  coordinates?: [number, number]; // [lat, lng]
};

export type ItineraryDay = {
  day: string;
  title: string;
  date: string;
  summary: string;
  events: ItineraryEvent[];
  mapHint?: string;
  reservations?: { label: string; details: string }[];
};

const itinerary: { days: ItineraryDay[] } = {
  days: [
    {
      day: '1일차',
      title: '프라하 도착 & 첫 일정',
      date: '2026-06-15',
      summary: '인천공항 출발 → 프라하 도착 후 호텔 체크인, 첫 저녁 식사.',
      mapHint: '프라하 공항 → 호텔 → 시내 이동 경로',
      reservations: [
        { label: 'AE 버스 티켓', details: '출국장 오른쪽 티켓박스, 1시간 소요' },
        { label: '호텔 예약', details: '그란디오르 호텔, 도보 1.2km' }
      ],
      events: [
        { time: '06:35', title: '인천공항 출발', location: '인천공항 1터미널', description: '공항버스 6019, 신대방삼거리역 4번 출구 출발', note: '약 ±10분' },
        { time: '07:35', title: '보딩 및 체크인', location: '인천공항 제2터미널', description: 'A 카운터 프리미엄 체크인, 라운지 티켓 수령' },
        { time: '18:00', title: 'AE 버스 탑승', location: '프라하 공항', description: '프라하 중앙역까지 1시간, 200 CZK', coordinates: [50.1006, 14.2600] },
        { time: '19:00', title: '호텔 이동', location: '그란디오르 호텔', description: '도보 1.2km 이동', coordinates: [50.0854, 14.4231] },
        { time: '20:00', title: '저녁 식사', location: '호텔 주변', description: '현지 레스토랑에서 여유로운 저녁', coordinates: [50.0870, 14.4210] }
      ]
    },
    {
      day: '2일차',
      title: '프라하 시내 탐방',
      date: '2026-06-16',
      summary: '프라하 성, 페트린 힐, 재즈바 방문으로 첫 현지 일정을 시작합니다.',
      mapHint: '프라하 성 → 페트린 힐 → 재즈바',
      reservations: [
        { label: '재즈바 예약', details: '저녁 8시 이후 방문 예정' }
      ],
      events: [
        { title: '프라하 성 방문', description: '성 내부와 성 비타 대성당 산책', coordinates: [50.0906, 14.4017] },
        { title: '페트린 힐 트레킹', description: '케이블카 또는 걸어서 전망대 이동', coordinates: [50.0834, 14.3935] },
        { title: '재즈바 방문', description: '프라하 현지 재즈바에서 저녁 시간 즐기기', coordinates: [50.0822, 14.4272] }
      ]
    },
    {
      day: '3일차',
      title: '프라하 여유 일정',
      date: '2026-06-17',
      summary: '프라하 골목과 카페를 느긋하게 즐기는 일정.',
      events: [
        { title: '구시가지 광장', description: '천문시계, 틴 성당 주변 산책', coordinates: [50.0875, 14.4213] },
        { title: '카를교', description: '카를교 보행 및 블타바 강 경관 감상', coordinates: [50.0865, 14.4114] },
        { title: '현지 카페', description: '프라하 인기 카페에서 여유 시간', coordinates: [50.0850, 14.4180] }
      ]
    },
    {
      day: '4일차',
      title: '프라하 추가 일정',
      date: '2026-06-18',
      summary: '프라하 박물관 혹은 쇼핑, 자유 일정을 즐길 수 있는 날.',
      events: [
        { title: '프라하 자유 일정', description: '리버 크루즈, 쇼핑, 또는 미술관 선택', coordinates: [50.0755, 14.4378] }
      ]
    },
    {
      day: '5일차',
      title: '크롬로프 이동',
      date: '2026-06-19',
      summary: '프라하에서 크롬로프로 이동해 체스키의 감성을 즐깁니다.',
      mapHint: '프라하 → 중앙버스스테이션 플로렌츠 → 크롬로프',
      reservations: [
        { label: '버스 Route 853', details: 'Central Bus Station Florenc 출발' }
      ],
      events: [
        { time: '10:00', title: '크롬로프 이동 출발', location: 'Central Bus Station Florenc', description: 'Route 853 15C / 15D', coordinates: [50.0872, 14.4359] },
        { title: '체스키 크룸로프 성', description: '유네스코 세계문화유산, 성 내부 및 정원 관람', coordinates: [48.8127, 14.3175] },
        { title: '블타바 강변 산책', description: '구시가지와 강변 전경 감상', coordinates: [48.8110, 14.3160] }
      ]
    },
    {
      day: '6일차',
      title: '할슈타트 이동',
      date: '2026-06-20',
      summary: '자연 경관이 아름다운 할슈타트로 이동하여 휴식과 산책.',
      mapHint: '크롬로프 → 할슈타트',
      reservations: [
        { label: 'CK Shuttle', details: 'Door to Door 셔틀 예약' }
      ],
      events: [
        { time: '10:00', title: '할슈타트 이동', description: 'CK Shuttle Door to Door', coordinates: [47.5622, 13.6493] },
        { title: '할슈타트 호수 산책', description: '세계에서 가장 아름다운 마을 중 하나 탐방', coordinates: [47.5617, 13.6489] },
        { title: '할슈타트 전망대', description: '세계유산 전망대에서 마을 전경 감상', coordinates: [47.5598, 13.6519] }
      ]
    },
    {
      day: '7일차',
      title: '빈으로 이동',
      date: '2026-06-21',
      summary: '할슈타트에서 빈으로 이동하고, 도시 중심을 둘러봅니다.',
      mapHint: '할슈타트 → Attnang-Puchheim → Wien Hbf',
      reservations: [
        { label: '기차 티켓', details: 'REX 70 입석 / IC 645 좌석 예약' }
      ],
      events: [
        { time: '10:45', title: '페리 탑승', description: 'Hallstatt Bahnhst → Attnang-Puchheim Bahnhof', coordinates: [47.5622, 13.6493] },
        { time: '11:32', title: 'REX 70 이동', description: '입석 이동', coordinates: [47.9297, 13.3440] },
        { time: '13:01', title: 'IC 645 탑승', description: 'Attnang-Puchheim → Wien Hbf, 프린트 티켓 필요', coordinates: [48.1853, 16.3762] }
      ]
    },
    {
      day: '8일차',
      title: '빈 자유 일정',
      date: '2026-06-22',
      summary: '빈의 궁전, 카페, 음악 공연을 즐기는 일정.',
      events: [
        { title: '쇤브룬 궁전', description: '정원과 내부 관람', coordinates: [48.1845, 16.3122] },
        { title: '링슈트라세 산책', description: '빈 도심 역사 거리 탐방', coordinates: [48.2049, 16.3689] },
        { title: '빈 전통 카페', description: '전통 커피하우스에서 휴식', coordinates: [48.2082, 16.3738] },
        { title: '음악 공연 옵션', description: '저녁 클래식 공연 고려', coordinates: [48.2034, 16.3690] }
      ]
    },
    {
      day: '9일차',
      title: '부다페스트 이동',
      date: '2026-06-23',
      summary: '빈에서 부다페스트로 이동, 헝가리 감성으로 전환합니다.',
      mapHint: 'Wien Hbf → Budapest',
      reservations: [
        { label: 'RJX 61 기차', details: '11:40 출발 → 14:19 도착, 앱 티켓 및 프린트 좌석' }
      ],
      events: [
        { time: '11:40', title: '부다페스트 이동 출발', location: 'Wien Hbf', description: 'RJX 61, 자리 27/33/35', coordinates: [48.1853, 16.3762] },
        { title: '부다페스트 도착', location: 'Budapest Keleti', description: '숙소 체크인 후 도심 탐방', coordinates: [47.4979, 19.0832] }
      ]
    },
    {
      day: '10일차',
      title: '부다페스트 일정',
      date: '2026-06-24',
      summary: '도시 탐방 및 온천, 다뉴브 야경을 즐기는 날.',
      events: [
        { title: '어부의 요새', description: '부다 언덕의 네오로마네스크 전망대', coordinates: [47.5021, 19.0344] },
        { title: '마차시 성당', description: '부다페스트 대표 성당 관람', coordinates: [47.5015, 19.0348] },
        { title: '국회의사당', description: '다뉴브강변 고딕 양식 건물 외관', coordinates: [47.5072, 19.0456] },
        { title: '세체니 다리', description: '부다와 페스트를 잇는 상징적인 다리', coordinates: [47.4981, 19.0452] },
        { title: '현지 음식', description: '헝가리 전통 메뉴 시식', coordinates: [47.4960, 19.0530] }
      ]
    },
    {
      day: '11일차',
      title: '마지막 일정 & 출국',
      date: '2026-06-25',
      summary: '세체니 온천과 공항 이동으로 여행을 마무리합니다.',
      mapHint: '부다페스트 시내 → 페렌츠 리스트 공항',
      reservations: [
        { label: '세체니 온천', details: 'Fasttrack with cabin, Printed Ticket' },
        { label: '항공편 KE 964', details: 'Terminal 2B 출발' }
      ],
      events: [
        { time: '11:00', title: '세체니 온천 방문', description: '11시까지 입장', coordinates: [47.5188, 19.0799] },
        { time: '20:00', title: '공항 이동', location: '페렌츠 리스트 공항 Terminal 2B', description: 'KE 964편 출국', coordinates: [47.4369, 19.2556] }
      ]
    }
  ]
};

export default itinerary;
