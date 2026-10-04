<?php
/**
 * 在线人数接口（静态站点专用，无后台依赖）
 * ============================================================
 * 通过 Minecraft「服务器列表查询」(Server List Ping) 协议，
 * 直接向游戏服务器要一份状态，只输出：
 *     {"success":true,"data":{"p":在线人数,"mp":最大人数}}
 *
 * 前端 script.js 读取 data.p 显示在线人数；查询失败则显示「离线」。
 *
 * ▸ 服务器地址/端口有变，改下面三个常量即可。
 * ▸ 若主机禁用了对外 TCP 连接，可以把 $ENABLED 设为 false，
 *   页面会直接显示「离线」（不影响其他功能）。
 * ▸ 若服务器用 SRV 记录（如 mc.xxx.com 指向别的端口），
 *   脚本会先尝试解析 _minecraft._tcp 的 SRV 记录。
 * ============================================================
 */

declare(strict_types=1);

const MC_HOST    = 'mc.xm233.cn';
const MC_PORT    = 25565;
const MC_TIMEOUT = 2.0;      // 秒；网络慢可调大，页面等待时间随之增加
const MC_ENABLED = true;     // 关闭查询时设为 false

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

/** 输出结果并结束 */
function respond(bool $ok, ?array $data): void
{
    echo json_encode(
        ['success' => $ok, 'data' => $data],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

/** 编码 VarInt（协议用） */
function encodeVarInt(int $value): string
{
    $out = '';
    do {
        $temp = $value & 0x7F;
        $value >>= 7;
        if ($value !== 0) {
            $temp |= 0x80;
        }
        $out .= chr($temp);
    } while ($value !== 0);
    return $out;
}

/** 从流中读一个 VarInt */
function readVarInt($fp): ?int
{
    $result  = 0;
    $numRead = 0;
    while (true) {
        $chunk = fread($fp, 1);
        if ($chunk === false || $chunk === '') {
            return null;
        }
        $byte    = ord($chunk);
        $result |= ($byte & 0x7F) << (7 * $numRead);
        $numRead++;
        if ($numRead > 5) {
            return null;
        }
        if (($byte & 0x80) === 0) {
            return $result;
        }
    }
}

/** 从字符串中读一个 VarInt，$offset 会被推进 */
function readVarIntFromString(string $buf, int &$offset): ?int
{
    $result  = 0;
    $numRead = 0;
    $len     = strlen($buf);
    while (true) {
        if ($offset >= $len) {
            return null;
        }
        $byte = ord($buf[$offset]);
        $offset++;
        $result |= ($byte & 0x7F) << (7 * $numRead);
        $numRead++;
        if ($numRead > 5) {
            return null;
        }
        if (($byte & 0x80) === 0) {
            return $result;
        }
    }
}

/** 解析 SRV 记录，返回 [host, port]；无记录时返回 null */
function resolveSrv(string $host): ?array
{
    if (!function_exists('dns_get_record') || !defined('DNS_SRV')) {
        return null;
    }
    $records = @dns_get_record('_minecraft._tcp.' . $host, DNS_SRV);
    if (!is_array($records) || $records === []) {
        return null;
    }
    foreach ($records as $r) {
        if (!empty($r['target'])) {
            return [rtrim((string) $r['target'], '.'), (int) ($r['port'] ?? 25565)];
        }
    }
    return null;
}

/** 查询服务器状态，成功返回 ['p'=>在线,'mp'=>最大]，失败返回 null */
function queryServer(string $host, int $port, float $timeout): ?array
{
    [$host, $port] = resolveSrv($host) ?? [$host, $port];

    $errno   = 0;
    $errstr  = '';
    $fp      = @fsockopen($host, $port, $errno, $errstr, $timeout);
    if ($fp === false) {
        return null;
    }
    stream_set_timeout($fp, (int) ceil($timeout));

    try {
        // 1) Handshake（协议版本 -1 表示仅查询状态）
        $payload  = "\x00";
        $payload .= "\x00";
        $payload .= pack('n', strlen($host)) . $host;
        $payload .= pack('n', $port);
        $payload .= "\x01";
        fwrite($fp, encodeVarInt(strlen($payload)) . $payload);

        // 2) Status Request
        fwrite($fp, encodeVarInt(1) . "\x00");

        // 3) 读取响应包
        $packetLen = readVarInt($fp);
        if ($packetLen === null || $packetLen <= 0) {
            return null;
        }

        $body = '';
        while (strlen($body) < $packetLen) {
            $chunk = fread($fp, $packetLen - strlen($body));
            if ($chunk === false || $chunk === '') {
                break;
            }
            $body .= $chunk;
        }
        if ($body === '') {
            return null;
        }

        $offset = 0;
        readVarIntFromString($body, $offset);                 // packet id
        $jsonLen = readVarIntFromString($body, $offset);      // JSON 字符串长度
        if ($jsonLen === null || $jsonLen <= 0) {
            return null;
        }
        $json    = substr($body, $offset, $jsonLen);
        $decoded = json_decode($json, true);
        if (!is_array($decoded) || !isset($decoded['players'])) {
            return null;
        }

        return [
            'p'  => (int) ($decoded['players']['online'] ?? 0),
            'mp' => (int) ($decoded['players']['max'] ?? 0),
        ];
    } finally {
        fclose($fp);
    }
}

if (!MC_ENABLED) {
    respond(false, null);
}

$status = queryServer(MC_HOST, MC_PORT, MC_TIMEOUT);
if ($status === null) {
    respond(false, null);   // 前端据此显示「离线」
}

respond(true, $status);
