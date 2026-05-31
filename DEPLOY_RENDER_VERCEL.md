# Deploy Frontend On Vercel And Backend On Render

This is the recommended hosted split for this repo:

- Frontend: Vercel, using the `frontend/` directory
- Backend: Render Docker web service, using `backend/Dockerfile`
- Database: Render Postgres with pgvector

## 1. Push The Latest Code

Commit and push these deployment files before creating services:

```bash
git add .
git commit -m "Prepare Render and Vercel deployment"
git push
```

## 2. Deploy Backend On Render

Use the included `render.yaml` as a Render Blueprint.

1. Open Render.
2. Create a new Blueprint from this GitHub repo.
3. Render should detect `render.yaml`.
4. When prompted, set:

```bash
GEMINI_API_KEY=your_real_gemini_key
CORS_ORIGINS=https://your-vercel-project.vercel.app
```

5. Deploy the blueprint.

Render will create:

- `examgpt-api` web service
- `examgpt-db` Postgres database
- a persistent disk mounted at `/app/data` for uploaded files

After deploy, test:

```bash
curl https://YOUR_RENDER_BACKEND_URL/health
```

Expected:

```json
{"status":"ok","service":"examgpt-api"}
```

Render notes:

- The backend Dockerfile binds to `${PORT:-10000}`, which Render requires.
- The app creates the `vector` extension automatically on startup.
- Render Postgres supports `pgvector` on supported PostgreSQL versions.

## 3. Deploy Frontend On Vercel

1. Open Vercel.
2. Import the same GitHub repo.
3. Set **Root Directory** to:

```bash
frontend
```

4. Framework preset: Next.js.
5. Build command: leave default or use:

```bash
npm run build
```

6. Add this Environment Variable for Production and Preview:

```bash
NEXT_PUBLIC_API_URL=https://YOUR_RENDER_BACKEND_URL
```

7. Deploy.

Important: `NEXT_PUBLIC_API_URL` is baked into the Next.js frontend at build
time. If you change the backend URL, redeploy the Vercel frontend.

## 4. Update CORS After Vercel Gives You The Final URL

After Vercel deploys, copy the frontend URL and update Render:

```bash
CORS_ORIGINS=https://your-vercel-project.vercel.app
```

If you add a custom domain later, include both origins:

```bash
CORS_ORIGINS=https://your-vercel-project.vercel.app,https://yourdomain.com
```

Redeploy the Render backend after changing CORS.

## 5. Common Problems

### Frontend Loads But Chat Fails

Check Vercel has:

```bash
NEXT_PUBLIC_API_URL=https://YOUR_RENDER_BACKEND_URL
```

Then redeploy Vercel.

### Backend CORS Error

Set Render `CORS_ORIGINS` to the exact Vercel URL shown in the browser. Do not
include a trailing slash.

### Backend Sleeps Or Is Slow First Time

Small Render instances can cold-start and the embedding/reranker models take
time to load. Wait for `/health` to pass before testing uploads/chat.

### Uploaded Files Disappear

Make sure the Render service has the persistent disk from `render.yaml`. It
mounts `/app/data`, and the backend stores uploads under `/app/data/uploads`.
