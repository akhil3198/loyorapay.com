#!/bin/bash
# LoyoraPay — Full Production Deploy Script
# Run once from ~/claude after any backend change
# Usage: bash deploy.sh

set -e
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

PROJECT_ID="togjwxlzieqysyrdbcil"

echo "▶ 1/3 Deploying edge functions to Supabase..."
npx supabase@latest functions deploy expire-points  --project-ref $PROJECT_ID
npx supabase@latest functions deploy invite-staff   --project-ref $PROJECT_ID
npx supabase@latest functions deploy pms-webhook    --project-ref $PROJECT_ID
npx supabase@latest functions deploy send-campaign  --project-ref $PROJECT_ID

echo "▶ 2/3 Deploying frontend to Netlify..."
npx netlify-cli@latest deploy \
  --dir . \
  --site 24b637b0-d742-45c1-bd88-35e2d3ea737f \
  --prod

echo "▶ 3/3 Pushing to GitHub..."
git add .
git commit -m "deploy: $(date '+%Y-%m-%d %H:%M')" --allow-empty
git push

echo "✓ Done — loyorapay.com is live"
