<?php
/**
 * 用户中心 CSS 资源引入
 * 通过 css.php 合并端点将 8 个 CSS 文件合并为 1 个 HTTP 请求。
 * 注意：此文件直接输出 <link> 标签，请在 <head> 中 include。
 */
$__userCssFiles = [
    'css/base.css', 'css/auth.css', 'css/layout.css', 'css/forms.css',
    'css/richtext.css', 'css/pages.css', 'css/effects.css', 'css/staff.css',
    'css/theme.css',
];
$__cssV = (int)@filemtime(__DIR__ . '/css.php');
foreach ($__userCssFiles as $__f) {
    $__t = (int)@filemtime(__DIR__ . '/' . $__f);
    if ($__t > $__cssV) $__cssV = $__t;
}
echo '    <link rel="stylesheet" href="css.php?v=' . $__cssV . '">' . "\n";
unset($__userCssFiles, $__cssV, $__f, $__t);
