# music-share

닉네임 입력 후 접속, DJ가 유튜브 링크를 추가하면 전원 동시 재생되는 사이트.

## Supabase 세팅

1. https://supabase.com 에서 프로젝트 생성.
2. `Authentication > Providers > Anonymous`에서 Anonymous sign-ins 활성화.
3. SQL Editor에서 `supabase/schema.sql` 실행.
4. `Project Settings > API`에서 URL/anon key 복사 → `js/config.js`에 붙여넣기.

## 로컬 실행

```bash
npx serve .
```

## 테스트

```bash
node --test test/pure.test.mjs
```

## GitHub Pages 배포

1. GitHub repo 생성 후 이 디렉터리 push.
2. repo Settings > Pages > Source를 `main` 브랜치 루트로 설정.
3. 배포된 URL을 리스너들에게 공유.
