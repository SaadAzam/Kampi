#!/bin/sh
set -eu
PORT="${PORT:-80}"
sed "s/LISTEN_PORT/${PORT}/g" /etc/nginx/templates/default.conf > /etc/nginx/conf.d/default.conf
exec nginx -g 'daemon off;'
