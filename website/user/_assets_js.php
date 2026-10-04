<?php
/**
 * 用户中心 JS 资源引入。
 * 通过 js.php 合并端点减少请求数，并使用源文件最大 mtime 进行缓存失效。
 */
$__userJsFiles = [
    'js/core.js', 'js/auth.js', 'js/richtext.js', 'js/scroll.js',
    'js/tickets.js', 'js/shop.js', 'js/interactions.js', 'js/ai-chat.js', 'js/bootstrap.js',
];
$__jsV = (int)@filemtime(__DIR__ . '/js.php');
foreach ($__userJsFiles as $__f) {
    $__t = (int)@filemtime(__DIR__ . '/' . $__f);
    if ($__t > $__jsV) $__jsV = $__t;
}
echo '    <script src="js.php?v=' . $__jsV . '" defer></script>' . "\n";
unset($__userJsFiles, $__jsV, $__f, $__t);
