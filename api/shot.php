<?php
// ============================================================
// ランキングに登録された画面キャプチャを返す
//   GET api/shot.php?id=123
// ============================================================

declare(strict_types=1);

ini_set('display_errors', '0');

$id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
if (!$id) {
    http_response_code(400);
    exit;
}

$path = __DIR__ . '/../data/ranking.sqlite3';
if (!is_file($path)) {
    http_response_code(404);
    exit;
}

try {
    $pdo = new PDO('sqlite:' . $path);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $stmt = $pdo->prepare('SELECT shot FROM ranking WHERE id = :id AND shot IS NOT NULL');
    $stmt->execute([':id' => $id]);
    $shot = $stmt->fetchColumn();
} catch (Throwable $e) {
    error_log('[shot] ' . $e->getMessage());
    http_response_code(500);
    exit;
}

if ($shot === false || $shot === null) {
    http_response_code(404);
    exit;
}

// 登録後に中身が変わることはないので長めにキャッシュさせる
header('Content-Type: image/jpeg');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: public, max-age=31536000, immutable');
header('Content-Length: ' . strlen($shot));
echo $shot;
