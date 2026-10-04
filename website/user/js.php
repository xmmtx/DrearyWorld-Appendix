<?php
/**
 * 用户中心 JS 合并端点
 * 把多个 JS 文件拼成一个长缓存响应，首屏 7 个请求 → 1 个。
 * staff.js 体积大且仅管理员需要，仍由 panel.php 单独按需加载。
 *
 * 用法：<script src="js.php?v=<mtime_max>" defer></script>
 *
 * 命中条件：客户端 If-None-Match 与服务端 ETag 相同 → 304。
 * 部署/改 JS 后 v 自动变更（mtime_max），URL 变 → 浏览器自动重取。
 */

declare(strict_types=1);

$files = [
    'js/core.js',
    'js/auth.js',
    'js/richtext.js',
    'js/scroll.js',
    'js/tickets.js',
    'js/shop.js',
    'js/interactions.js',
    'js/ai-chat.js',
    'js/bootstrap.js',
];

$base = __DIR__;
$sig = '';
$exists = [];
foreach ($files as $rel) {
    $path = $base . '/' . $rel;
    if (is_file($path)) {
        $exists[] = $path;
        $sig .= '|' . $rel . '|' . filemtime($path) . '|' . filesize($path);
    }
}
$etag = '"' . md5($sig) . '"';

header('Content-Type: application/javascript; charset=utf-8');
header('Cache-Control: public, max-age=31536000, immutable');
header('ETag: ' . $etag);
header('X-Content-Type-Options: nosniff');

$ifNoneMatch = trim($_SERVER['HTTP_IF_NONE_MATCH'] ?? '');
if ($ifNoneMatch !== '' && $ifNoneMatch === $etag) {
    http_response_code(304);
    exit;
}

if (!ob_start('ob_gzhandler')) ob_start();

foreach ($exists as $path) {
    echo "// === " . basename($path) . " ===\n";
    readfile($path);
    echo "\n;\n";
}
