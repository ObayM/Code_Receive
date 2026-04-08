#!/bin/sh
set -e

# Run prisma db push as root (before dropping to nextjs user)
# so it can write to the volume-mounted SQLite database
npx prisma db push --accept-data-loss

# Fix ownership so the nextjs user can read/write the database at runtime
chown -R nextjs:nodejs /app/data

# Drop to nextjs user and start the server
exec su -s /bin/sh nextjs -c "node server.js"
