# music-share (Sugar DJ)

실시간 음악 공유 플레이어. 브라우저에서 DJ가 선곡한 유튜브 음악을 모든 리스너가 동일한 싱크로 함께 듣습니다.

## 설정 (Configuration)

보안을 위해 실제 API 키가 포함된 `js/config.js`는 `.gitignore`에 등록되어 Git에 올라가지 않습니다.

### 1. 로컬 개발 설정

1. 템플릿 복사:
   ```bash
   cp js/config.example.js js/config.js
   ```
2. `js/config.js` 파일을 열고 실제 키를 입력:
   - `SUPABASE_URL`: Supabase 프로젝트 URL
   - `SUPABASE_ANON_KEY`: Supabase anon key
   - `YOUTUBE_API_KEY`: Google Cloud Console에서 발급한 YouTube Data API v3 키 (배포 도메인으로 HTTP 리퍼러 제한 권장)

### 2. Supabase 세팅

1. https://supabase.com 에서 프로젝트 생성.
2. `Authentication > Providers > Anonymous`에서 Anonymous sign-ins 활성화.
3. SQL Editor에서 `supabase/schema.sql` 및 `supabase/migrations/20260820_guest_role_and_volume.sql` 실행.

## 로컬 실행

```bash
npx serve .
```

## 테스트

```bash
npm test
# 또는
node --test test/pure.test.mjs
```

## 배포 (Deployment)

### A. GitHub Pages (GitHub Actions 사용)
1. GitHub 저장소의 `Settings > Secrets and variables > Actions`에 3개 Repository Secret 등록:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `YOUTUBE_API_KEY`
2. `Settings > Pages > Build and deployment`에서 Source를 **GitHub Actions**로 선택.
3. main 브랜치에 푸시하면 `.github/workflows/deploy.yml`이 자동으로 `js/config.js`를 생성하여 안전하게 배포합니다.

### B. Vercel / Netlify / Cloudflare Pages
1. 배포 설정의 **Environment Variables**에 동일하게 3개 환경 변수 등록.
2. Build Command: `npm run build` (내부적으로 `node scripts/generate-config.js` 실행).
3. Output Directory: `.` (루트).

> **기존에 `js/config.js`가 Git에 이미 커밋되어 있었던 경우:**
> 로컬 파일은 유지하면서 Git 추적만 해제하려면 다음 명령을 실행하세요:
> ```bash
> git rm --cached js/config.js
> ```

