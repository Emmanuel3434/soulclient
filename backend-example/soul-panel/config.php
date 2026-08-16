<?php
// Credenciales de Supabase — quedan solo aquí, nunca llegan al navegador.
define('SUPABASE_URL', 'https://tryqwbidrcmdhkyllxti.supabase.co');
define('SUPABASE_SECRET_KEY', 'REEMPLAZA_CON_TU_SECRET_KEY');
// Bucket público que guarda los ZIP de las instancias (mismo que el worker).
define('SUPABASE_BUCKET', 'instances');
// Token de publicación que el launcher envía (Bearer) para las acciones de
// sincronización sync_* (upsert/delete de instancias y mods). Debe coincidir
// con el "publish token" configurado en el launcher (Ajustes). Vacío = se
// omite la verificación (solo para desarrollo local).
define('SOULCLIENT_PUBLISH_TOKEN', '');
