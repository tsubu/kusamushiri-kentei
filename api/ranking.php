<?php
// ============================================================
// 草むしり検定実技 ランキングAPI（SQLite3）
//   GET  api/ranking.php                      … 上位10件を返す
//   POST api/ranking.php {action:"start"}     … プレイ開始。1回だけ使える登録用トークンを返す
//   POST api/ranking.php {token, name, distance, grass, rank, shot}
//                                             … 記録を登録し、順位と上位10件を返す
//                                               shot はゲームオーバー時の画面キャプチャ（JPEG の data URL、任意）
// 並び順は 草むしりスコア → 走行距離 → 先に登録した人
//
// セキュリティ上の対策
//   - スコアはブラウザから届く値なので、サーバーで計った「開始からの経過時間」で
//     ありえない距離・段位・草スコアをはじく（トークンは1回きり・期限つき）
//   - 別サイトからの送信（Origin / Sec-Fetch-Site）と JSON 以外の送信を拒否
//   - 送信サイズ・連投・1日の登録数・トークン発行数に上限
// ============================================================

declare(strict_types=1);

ini_set('display_errors', '0');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

const RANKING_LIMIT = 10;
const NAME_MAX = 10;
const SHOT_MAX_BYTES = 400 * 1024;
const SHOT_MAX_SIZE = 1280;
const BODY_MAX_BYTES = 640 * 1024;      // キャプチャの base64（約1.34倍）＋α
const TOKEN_TTL = 3 * 60 * 60;          // トークンの有効期限（秒）
const SUBMIT_INTERVAL = 5;              // 同じ接続元からの連続登録の間隔（秒）
const SUBMIT_PER_DAY = 50;              // 同じ接続元からの1日の登録数
const START_PER_10MIN = 60;             // 同じ接続元からの10分間のトークン発行数

// game.js の RANKS と同じ段位と速度（km/h）。記録の妥当性チェックに使う
const RANKS = [
    ['label' => '検定落ち', 'duration' => 40,  'min' => 40,  'max' => 60],
    ['label' => '5級',      'duration' => 40,  'min' => 60,  'max' => 80],
    ['label' => '4級',      'duration' => 40,  'min' => 80,  'max' => 100],
    ['label' => '3級',      'duration' => 30,  'min' => 100, 'max' => 120],
    ['label' => '2級',      'duration' => 30,  'min' => 120, 'max' => 150],
    ['label' => '1級',      'duration' => 300, 'min' => 150, 'max' => 500],
];

function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function dataDir(): string
{
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) {
        mkdir($dir, 0770, true);
    }
    return $dir;
}

function openDb(): PDO
{
    $pdo = new PDO('sqlite:' . dataDir() . '/ranking.sqlite3');
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 3000');
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS ranking (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            distance   INTEGER NOT NULL,
            grass      INTEGER NOT NULL,
            rank_label TEXT    NOT NULL,
            ip_hash    TEXT    NOT NULL,
            shot       BLOB,
            created_at TEXT    NOT NULL DEFAULT (datetime(\'now\', \'localtime\'))
        )'
    );
    // 以前のテーブルにキャプチャ列がなければ追加する
    $columns = array_column($pdo->query('PRAGMA table_info(ranking)')->fetchAll(), 'name');
    if (!in_array('shot', $columns, true)) {
        $pdo->exec('ALTER TABLE ranking ADD COLUMN shot BLOB');
    }
    $pdo->exec('DROP INDEX IF EXISTS idx_ranking_score');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ranking_grass ON ranking (grass DESC, distance DESC, id ASC)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_ranking_ip ON ranking (ip_hash, created_at)');

    // プレイごとに発行する1回きりのトークン
    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS plays (
            token      TEXT    PRIMARY KEY,
            ip_hash    TEXT    NOT NULL,
            started_at INTEGER NOT NULL,
            used_at    INTEGER
        )'
    );
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_plays_ip ON plays (ip_hash, started_at)');
    return $pdo;
}

// 接続元をそのまま保存しないよう、サーバーごとの秘密の値を混ぜてハッシュ化する
function ipHash(): string
{
    $keyFile = dataDir() . '/secret.key';
    if (!is_file($keyFile)) {
        $fp = fopen($keyFile, 'c+');
        if ($fp && flock($fp, LOCK_EX)) {
            if (filesize($keyFile) === 0) {
                fwrite($fp, bin2hex(random_bytes(32)));
            }
            flock($fp, LOCK_UN);
        }
        if ($fp) {
            fclose($fp);
        }
        @chmod($keyFile, 0600);
    }
    $secret = (string)file_get_contents($keyFile);
    return hash_hmac('sha256', $_SERVER['REMOTE_ADDR'] ?? '', $secret);
}

// 草むしりスコア → 距離 → 先に登録した人 の順で並べる（草むしり検定なので草が主役）
function topRanking(PDO $pdo): array
{
    $stmt = $pdo->prepare(
        'SELECT id, name, distance, grass, rank_label AS rank, created_at, shot IS NOT NULL AS has_shot
           FROM ranking
          ORDER BY grass DESC, distance DESC, id ASC
          LIMIT :limit'
    );
    $stmt->bindValue(':limit', RANKING_LIMIT, PDO::PARAM_INT);
    $stmt->execute();
    $rows = $stmt->fetchAll();
    foreach ($rows as $i => &$row) {
        $row['position'] = $i + 1;
        $row['id'] = (int)$row['id'];
        $row['distance'] = (int)$row['distance'];
        $row['grass'] = (int)$row['grass'];
        $row['has_shot'] = (bool)$row['has_shot'];
    }
    return $rows;
}

function cleanName(mixed $name): ?string
{
    if (!is_string($name)) {
        return null;
    }
    // 制御文字・書式文字（ゼロ幅文字や文字の向きを変える文字を含む）を除き、空白をまとめる
    $name = preg_replace('/[\p{C}]/u', '', $name) ?? '';
    $name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
    $len = mb_strlen($name, 'UTF-8');
    if ($len < 1 || $len > NAME_MAX) {
        return null;
    }
    return $name;
}

function toInt(mixed $v, int $max): ?int
{
    if (!is_int($v) && !(is_float($v) && floor($v) === $v) && !(is_string($v) && ctype_digit($v))) {
        return null;
    }
    $n = (int)$v;
    return ($n < 0 || $n > $max) ? null : $n;
}

// 画面キャプチャ（JPEG の data URL）を検証してバイナリで返す。無い・不正なら null
function cleanShot(mixed $shot): ?string
{
    $prefix = 'data:image/jpeg;base64,';
    if (!is_string($shot) || !str_starts_with($shot, $prefix)) {
        return null;
    }
    $bin = base64_decode(substr($shot, strlen($prefix)), true);
    if ($bin === false || strlen($bin) > SHOT_MAX_BYTES) {
        return null;
    }
    $info = @getimagesizefromstring($bin);
    if ($info === false || $info[2] !== IMAGETYPE_JPEG || $info[0] > SHOT_MAX_SIZE || $info[1] > SHOT_MAX_SIZE) {
        return null;
    }
    return $bin;
}

// 経過時間 t 秒の時点で出せる最高速度（m/s）
function targetSpeed(float $t): float
{
    foreach (RANKS as $r) {
        if ($t < $r['duration']) {
            return ($r['min'] + ($r['max'] - $r['min']) * ($t / $r['duration'])) / 3.6;
        }
        $t -= $r['duration'];
    }
    return RANKS[count(RANKS) - 1]['max'] / 3.6;
}

// 経過時間 T 秒で走れる最大距離（最高速度で走り続けた場合）
function maxDistance(float $seconds): float
{
    $d = 0.0;
    $step = 0.5;
    for ($t = 0.0; $t < $seconds; $t += $step) {
        $d += targetSpeed($t) * min($step, $seconds - $t);
    }
    return $d;
}

// 経過時間 T 秒で到達できる段位の番号
function maxRankIndex(float $seconds): int
{
    $t = 0;
    foreach (RANKS as $i => $r) {
        $t += $r['duration'];
        if ($seconds < $t) {
            return $i;
        }
    }
    return count(RANKS) - 1;
}

// 別サイトのページからの送信を拒否する
function assertSameOrigin(): void
{
    $site = $_SERVER['HTTP_SEC_FETCH_SITE'] ?? '';
    if ($site !== '' && !in_array($site, ['same-origin', 'none'], true)) {
        respond(403, ['ok' => false, 'error' => '送信元が正しくありません']);
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        $host = parse_url($origin, PHP_URL_HOST);
        $port = parse_url($origin, PHP_URL_PORT);
        $originHost = $host . ($port ? ':' . $port : '');
        if (!hash_equals(strtolower($_SERVER['HTTP_HOST'] ?? ''), strtolower($originHost))) {
            respond(403, ['ok' => false, 'error' => '送信元が正しくありません']);
        }
    }
}

function readJsonBody(): array
{
    $type = $_SERVER['CONTENT_TYPE'] ?? '';
    if (!str_starts_with(strtolower($type), 'application/json')) {
        respond(415, ['ok' => false, 'error' => '送信形式が正しくありません']);
    }
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > BODY_MAX_BYTES) {
        respond(413, ['ok' => false, 'error' => '送信データが大きすぎます']);
    }
    $raw = file_get_contents('php://input', false, null, 0, BODY_MAX_BYTES + 1);
    if ($raw === false || strlen($raw) > BODY_MAX_BYTES) {
        respond(413, ['ok' => false, 'error' => '送信データが大きすぎます']);
    }
    $input = json_decode($raw, true, 4);
    if (!is_array($input)) {
        respond(400, ['ok' => false, 'error' => '送信データが読み取れませんでした']);
    }
    return $input;
}

function startPlay(PDO $pdo, string $ipHash): void
{
    $now = time();
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM plays WHERE ip_hash = :ip AND started_at > :since');
    $stmt->execute([':ip' => $ipHash, ':since' => $now - 600]);
    if ((int)$stmt->fetchColumn() >= START_PER_10MIN) {
        respond(429, ['ok' => false, 'error' => 'しばらく待ってから遊んでください']);
    }
    // 古いトークンは掃除する
    $pdo->prepare('DELETE FROM plays WHERE started_at < :old')->execute([':old' => $now - 86400]);

    $token = bin2hex(random_bytes(24));
    $pdo->prepare('INSERT INTO plays (token, ip_hash, started_at) VALUES (:t, :ip, :now)')
        ->execute([':t' => $token, ':ip' => $ipHash, ':now' => $now]);
    respond(200, ['ok' => true, 'token' => $token]);
}

function submitScore(PDO $pdo, string $ipHash, array $input): void
{
    $token = $input['token'] ?? null;
    $name = cleanName($input['name'] ?? null);
    $distance = toInt($input['distance'] ?? null, 2000000);
    $grass = toInt($input['grass'] ?? null, 2000000);
    $rank = $input['rank'] ?? null;
    $rankIndex = array_search($rank, array_column(RANKS, 'label'), true);
    $shot = cleanShot($input['shot'] ?? null);

    if (!is_string($token) || !preg_match('/\A[0-9a-f]{48}\z/', $token)) {
        respond(400, ['ok' => false, 'error' => 'プレイ情報がありません。もう一度遊んでから登録してください']);
    }
    if ($name === null) {
        respond(400, ['ok' => false, 'error' => 'なまえは1〜' . NAME_MAX . '文字で入れてください']);
    }
    if ($distance === null || $grass === null || $rankIndex === false) {
        respond(400, ['ok' => false, 'error' => '記録の値が正しくありません']);
    }

    // 連投・1日の登録数
    $stmt = $pdo->prepare(
        "SELECT
            SUM(created_at > datetime('now', 'localtime', :interval)),
            COUNT(*)
           FROM ranking
          WHERE ip_hash = :ip AND created_at > datetime('now', 'localtime', '-1 day')"
    );
    $stmt->execute([':ip' => $ipHash, ':interval' => '-' . SUBMIT_INTERVAL . ' seconds']);
    [$recent, $today] = array_map('intval', $stmt->fetch(PDO::FETCH_NUM));
    if ($recent > 0) {
        respond(429, ['ok' => false, 'error' => '少し待ってからもう一度登録してください']);
    }
    if ($today >= SUBMIT_PER_DAY) {
        respond(429, ['ok' => false, 'error' => '今日はこれ以上登録できません']);
    }

    $pdo->beginTransaction();
    try {
        // トークンは1回きり。使用済みにできた時だけ先へ進む
        $now = time();
        $stmt = $pdo->prepare('SELECT started_at FROM plays WHERE token = :t AND used_at IS NULL');
        $stmt->execute([':t' => $token]);
        $startedAt = $stmt->fetchColumn();
        if ($startedAt === false || $now - (int)$startedAt > TOKEN_TTL) {
            $pdo->rollBack();
            respond(400, ['ok' => false, 'error' => 'このプレイは登録済みか、期限が切れています']);
        }
        $pdo->prepare('UPDATE plays SET used_at = :now WHERE token = :t')->execute([':now' => $now, ':t' => $token]);

        // サーバーで計った経過時間で、ありえない記録をはじく
        // （カウントダウンや一時停止の分だけ経過時間は長めになるので、上限としては安全側）
        $elapsed = (float)($now - (int)$startedAt) + 2.0;
        $distanceLimit = maxDistance($elapsed) * 1.05 + 30;
        // 草は1mあたり最大でも2.5点程度（高得点草と横はじきのボーナス込みで余裕を持たせた値）
        $grassLimit = $distance * 2.5 + 100;
        if ($distance > $distanceLimit || $rankIndex > maxRankIndex($elapsed) || $grass > $grassLimit) {
            $pdo->commit(); // トークンは使用済みのままにする
            error_log(sprintf('[ranking] rejected: d=%d g=%d rank=%s elapsed=%.1f', $distance, $grass, $rank, $elapsed));
            respond(400, ['ok' => false, 'error' => '記録を確認できませんでした']);
        }

        $stmt = $pdo->prepare(
            'INSERT INTO ranking (name, distance, grass, rank_label, ip_hash, shot)
             VALUES (:name, :distance, :grass, :rank, :ip, :shot)'
        );
        $stmt->bindValue(':name', $name);
        $stmt->bindValue(':distance', $distance, PDO::PARAM_INT);
        $stmt->bindValue(':grass', $grass, PDO::PARAM_INT);
        $stmt->bindValue(':rank', $rank);
        $stmt->bindValue(':ip', $ipHash);
        $stmt->bindValue(':shot', $shot, $shot === null ? PDO::PARAM_NULL : PDO::PARAM_LOB);
        $stmt->execute();
        $id = (int)$pdo->lastInsertId();
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $e;
    }

    // 自分より上の人数 + 1 が順位
    $stmt = $pdo->prepare(
        'SELECT COUNT(*) FROM ranking
          WHERE grass > :g
             OR (grass = :g AND distance > :d)
             OR (grass = :g AND distance = :d AND id < :id)'
    );
    $stmt->execute([':d' => $distance, ':g' => $grass, ':id' => $id]);
    $position = (int)$stmt->fetchColumn() + 1;

    respond(200, ['ok' => true, 'id' => $id, 'position' => $position, 'ranking' => topRanking($pdo)]);
}

try {
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method === 'GET') {
        respond(200, ['ok' => true, 'ranking' => topRanking(openDb())]);
    }
    if ($method !== 'POST') {
        header('Allow: GET, POST');
        respond(405, ['ok' => false, 'error' => 'method not allowed']);
    }

    assertSameOrigin();
    $input = readJsonBody();
    $pdo = openDb();
    $ipHash = ipHash();

    if (($input['action'] ?? '') === 'start') {
        startPlay($pdo, $ipHash);
    }
    submitScore($pdo, $ipHash, $input);
} catch (Throwable $e) {
    error_log('[ranking] ' . $e->getMessage());
    respond(500, ['ok' => false, 'error' => 'ランキングの処理に失敗しました']);
}
