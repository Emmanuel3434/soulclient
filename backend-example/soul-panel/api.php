<?php
require __DIR__ . '/config.php';
header('Content-Type: application/json');

// Tablas conocidas del launcher
$KNOWN_TABLES = [
  'instances', 'mods', 'config_files', 'instance_folders',
  'whitelist', 'access_codes', 'code_redemptions', 'news', 'admins',
];

function supabaseRequest($method, $path, $body = null, $extraHeaders = []) {
  $ch = curl_init(SUPABASE_URL . '/rest/v1/' . $path);
  $headers = array_merge([
    'apikey: ' . SUPABASE_SECRET_KEY,
    'Authorization: Bearer ' . SUPABASE_SECRET_KEY,
    'Content-Type: application/json',
  ], $extraHeaders);

  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => $method,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER => true,
    CURLOPT_TIMEOUT => 15,
  ]);
  if ($body !== null) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
  }

  $response = curl_exec($ch);
  if ($response === false) {
    $err = curl_error($ch);
    curl_close($ch);
    throw new Exception('Error de red hacia Supabase: ' . $err);
  }
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
  curl_close($ch);

  $rawHeaders = substr($response, 0, $headerSize);
  $rawBody = substr($response, $headerSize);
  $decoded = json_decode($rawBody, true);

  if ($status >= 400) {
    $msg = $decoded['message'] ?? ('HTTP ' . $status);
    throw new Exception($msg);
  }

  // Content-Range: 0-9/23  -> total = 23
  $total = null;
  if (preg_match('/content-range:\s*[^\/]+\/(\d+|\*)/i', $rawHeaders, $m)) {
    $total = $m[1] === '*' ? null : (int)$m[1];
  }

  return ['body' => $decoded, 'total' => $total];
}

// Pide a Supabase Storage una URL firmada para subir el ZIP de una instancia
// (PUT directo del navegador, válida 2 h, con x-upsert: true para repúblicar).
function storageSignedUploadUrl($id) {
  $ch = curl_init(SUPABASE_URL . '/storage/v1/object/upload/sign/' . SUPABASE_BUCKET . '/' . rawurlencode($id) . '.zip');
  curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST => 'POST',
    CURLOPT_HTTPHEADER => [
      'apikey: ' . SUPABASE_SECRET_KEY,
      'Authorization: Bearer ' . SUPABASE_SECRET_KEY,
      'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode(['expiresIn' => 7200]),
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 15,
  ]);
  $response = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
  if ($response === false || $status >= 400) {
    throw new Exception('No se pudo iniciar la subida (HTTP ' . $status . ')');
  }
  $data = json_decode($response, true);
  $raw = $data['signedUrl'] ?? $data['signedURL'] ?? $data['url'] ?? null;
  if (!$raw) {
    throw new Exception('Respuesta de subida inválida');
  }
  // A veces la URL viene relativa al gateway de storage (/storage/v1/...).
  if (preg_match('#^https?://#', $raw)) return $raw;
  return SUPABASE_URL . '/storage/v1' . ($raw[0] === '/' ? '' : '/') . $raw;
}

$action = $_GET['action'] ?? '';
$table = $_GET['table'] ?? '';
$id = $_GET['id'] ?? null;

if ($table && !in_array($table, $KNOWN_TABLES, true)) {
  http_response_code(400);
  echo json_encode(['error' => 'Tabla no permitida']);
  exit;
}

try {
  switch ($action) {

    case 'status':
      supabaseRequest('GET', 'news?select=id&limit=1');
      echo json_encode(['ok' => true, 'database' => 'Supabase']);
      break;

    case 'tables':
      echo json_encode(array_map(fn($t) => ['name' => $t], $KNOWN_TABLES));
      break;

    case 'rows':
      $limit = min((int)($_GET['limit'] ?? 50), 200);
      $offset = (int)($_GET['offset'] ?? 0);
      $result = supabaseRequest('GET', "$table?select=*&order=id", null, [
        'Range: ' . $offset . '-' . ($offset + $limit - 1),
        'Prefer: count=exact',
      ]);
      $rows = $result['body'] ?? [];
      $columns = $rows ? array_map(fn($k) => ['name' => $k], array_keys($rows[0])) : [];
      echo json_encode([
        'columns' => $columns,
        'primaryKey' => 'id',
        'rows' => $rows,
        'total' => $result['total'] ?? count($rows),
      ]);
      break;

    case 'insert':
      $data = json_decode(file_get_contents('php://input'), true) ?? [];
      // Quita campos vacíos para dejar que Postgres use sus valores por defecto (uuid, timestamps, etc.)
      $data = array_filter($data, fn($v) => $v !== '' && $v !== null);
      $result = supabaseRequest('POST', "$table", (object)$data, ['Prefer: return=representation']);
      echo json_encode(['ok' => true, 'row' => $result['body'][0] ?? null]);
      break;

    case 'update':
      $data = json_decode(file_get_contents('php://input'), true) ?? [];
      unset($data['id']); // el id no se edita
      $result = supabaseRequest('PATCH', "$table?id=eq." . urlencode($id), (object)$data, ['Prefer: return=representation']);
      echo json_encode(['ok' => true, 'row' => $result['body'][0] ?? null]);
      break;

    case 'delete':
      supabaseRequest('DELETE', "$table?id=eq." . urlencode($id));
      echo json_encode(['ok' => true]);
      break;

    case 'sign_upload':
      if (!$id) { http_response_code(400); echo json_encode(['error' => 'Falta id']); break; }
      echo json_encode(['signedUrl' => storageSignedUploadUrl($id)]);
      break;

    case 'finalize_publish':
      $data = json_decode(file_get_contents('php://input'), true) ?? [];
      if (!$id) { http_response_code(400); echo json_encode(['error' => 'Falta id']); break; }
      $now = gmdate('Y-m-d\TH:i:s\Z');
      // Conserva la primera fecha de publicación (como hace el worker).
      $prev = supabaseRequest('GET', "instances?select=published_at&id=eq." . urlencode($id));
      $publishedAt = $prev['body'][0]['published_at'] ?? null;
      $result = supabaseRequest('PATCH', "instances?id=eq." . urlencode($id), (object)[
        'sha256' => $data['sha256'] ?? '',
        'size_bytes' => (int)($data['size_bytes'] ?? 0),
        'published_at' => $publishedAt ?? $now,
        'updated_at' => $now,
      ], ['Prefer: return=representation']);
      echo json_encode(['ok' => true, 'row' => $result['body'][0] ?? null]);
      break;

    default:
      http_response_code(400);
      echo json_encode(['error' => 'Acción desconocida']);
  }
} catch (Exception $e) {
  http_response_code(500);
  echo json_encode(['error' => $e->getMessage()]);
}
