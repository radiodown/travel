# 허니문 여행 플랜 웹사이트

React + Vite + TypeScript를 사용한 정적 여행 일정 사이트 기본 템플릿입니다.

## 시작

1. 패키지 설치

```bash
npm install
```

2. 개발 서버 실행

```bash
npm run dev
```

3. 정적 빌드

```bash
npm run build
```

## 설명

- `src/App.tsx`: 전체 페이지 레이아웃과 Day별 탭 구조
- `src/data/itinerary.ts`: 10박 11일 여행 일정 데이터
- `src/components/FlowOverview.tsx`: 여행 전체 흐름 카드
- `src/components/DayTabs.tsx`: Day별 탭 메뉴
- `src/components/DayDetails.tsx`: 선택한 Day 상세 일정, 지도 & 예약 정보

## GitHub Pages 배포

`npm run build`로 생성된 `dist/` 폴더를 GitHub Pages에 업로드하면 정적 배포가 가능합니다.
