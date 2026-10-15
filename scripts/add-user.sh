#!/usr/bin/env bash
# Додає користувача окремого застосунку (у FamilyHub користувачі беруться звідти, цей скрипт не потрібен).
#   ./scripts/add-user.sh kostya Костя
# Логін — ним входять у форму (латиниця), ім'я — як показувати в застосунку.
# Пароль генерується, дописується в .env і показується ОДИН раз — збережіть його.
# Потім контейнер перестворюється, щоб перечитати .env; якщо він не піднявся — .env повертається.
set -euo pipefail
cd "$(dirname "$0")/.."

login="${1:-}"
name="${2:-$login}"
if [[ ! "$login" =~ ^[a-z][a-z0-9_]{1,31}$ ]]; then
  echo "Використання: $0 <логін> [ім'я]   напр.: $0 kostya Костя" >&2
  echo "Логін: латиниця в нижньому регістрі, цифри, _ (2–32 символи)." >&2
  exit 1
fi
if [[ -z "${name// }" || "$name" =~ [\$\"\'\\#] ]]; then
  echo "Ім'я не може бути порожнім або містити \$ \" ' \\ #" >&2
  exit 1
fi
key="${login^^}"
[ -f .env ] || { echo "Немає .env у $(pwd)" >&2; exit 1; }
if grep -q "^PASSWORD_${key}=" .env; then
  echo "Користувач $login уже є (PASSWORD_${key} у .env)" >&2
  exit 1
fi

backup=".env.bak-$(date +%Y%m%d-%H%M%S)"
cp -p .env "$backup"
password=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-20)
[ -n "$(tail -c1 .env)" ] && echo >> .env
printf 'PASSWORD_%s=%s\nNAME_%s=%s\n' "$key" "$password" "$key" "$name" >> .env

healthy() {
  for _ in $(seq 1 20); do
    docker exec meds-tracker node -e \
      "fetch('http://127.0.0.1:3004/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1 && return 0
    sleep 1
  done
  return 1
}

docker compose up -d --force-recreate --no-build >/dev/null 2>&1 || true
if ! healthy; then
  cp -p "$backup" .env
  docker compose up -d --force-recreate --no-build >/dev/null 2>&1 || true
  echo "Контейнер не піднявся з новим .env — повернуто попередній ($backup). Логи: docker logs meds-tracker" >&2
  exit 1
fi

cat <<EOF
Готово, користувача додано. Вхід: https://meds.marikkish.com
  Логін:  $login
  Пароль: $password
Пароль більше ніде не показується — збережіть його. У .env він лежить як PASSWORD_${key}.
EOF
