#!/bin/bash
# Copy static files to standalone output
cp -r /root/Payjarvis/apps/admin/.next/static /root/Payjarvis/apps/admin/.next/standalone/Payjarvis/apps/admin/.next/static 2>/dev/null
cp -r /root/Payjarvis/apps/admin/public /root/Payjarvis/apps/admin/.next/standalone/Payjarvis/apps/admin/public 2>/dev/null

cd /root/Payjarvis/apps/admin/.next/standalone/Payjarvis/apps/admin
PORT=${PORT:-3005} HOSTNAME=0.0.0.0 node server.js
