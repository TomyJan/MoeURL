<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title>跳转中 - <?php echo $TITLE ?></title>
    <link rel="stylesheet" href="https://cdn.amoe.cc/lib/mdui/latest/css/mdui.min.css" />
    <meta http-equiv="refresh" content="<?php echo $JUMP_TIME ?>;url=<?php echo $databaseQuery['result'][0]['url'] ?>">
    
    <!-- Global site tag (gtag.js) - Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-N194P9LRRJ"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        
        gtag('config', 'G-N194P9LRRJ');
    </script>
    
    <script defer src="https://umami.amoe.cc/script.js" data-website-id="d787de1d-a88e-4a9e-b6d9-7da3c9783d47"></script>
    
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3486166483876303" crossorigin="anonymous"></script>
</head>

<body class="mdui-theme-primary-pink mdui-theme-accent-pink">

    <body>
        <div id='imgBox' class="mdui-container" style="max-width: 400px; ">
            <br><br><br>
            <div class="mdui-card">
                <div class="mdui-card-media" style="max-height: 80vh; width: auto;">
                    <img id='imgSrc' src="" />
                    <div class="mdui-card-media-covered">
                        <div class="mdui-card-primary">
                            <div id='imgName' class="mdui-card-primary-title">即将前往 <?php echo parse_url($databaseQuery['result'][0]['url'], PHP_URL_HOST); ?> 喵~</div>
                            <div id='imgUrl' class="mdui-card-primary-subtitle"><?php echo "后台加载页面中，再等等啦" ?></div>
                        </div>
                    </div>
                </div>
                <div id='Remind'>
                    <div class="mdui-card-content">
                        <center><img src="/loading.gif" /></center><br>
                        <div class="mdui-progress">
                            <div id='loadingStatus' class="mdui-progress-determinate" style="width: 0%;"></div>
                        </div>
                    </div>
                </div>
            </div>
            <br><br><br><br>
        </div>
        
        
        <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3486166483876303" crossorigin="anonymous"></script>
        <ins class="adsbygoogle"
             style="display:block"
             data-ad-format="autorelaxed"
             data-ad-client="ca-pub-3486166483876303"
             data-ad-slot="3059249626"></ins>
        <script>
             (adsbygoogle = window.adsbygoogle || []).push({});
        </script>
        
        <script src="https://cdn.amoe.cc/lib/mdui/latest/js/mdui.min.js"></script>
    </body>

</html>

<script>
    image_get();

    mdui.snackbar({
        message: '正在准备跳转中...',
        timeout: 1000
    });

    function image_get() {
        document.getElementById("imgBox").style = "max-width: 1000px;";
        document.getElementById("imgSrc").src = '';
        document.getElementById("Remind").innerHTML = '<div class="mdui-card-content"><center><img src="/loading.gif"/></center><br><div class="mdui-progress"><div id=\'loadingStatus\' class="mdui-progress-determinate" style="width: 100%;"></div></div></div>';
        var xhr = new XMLHttpRequest();
        xhr.onreadystatechange = function() {
            switch (xhr.readyState) {
                case 4:
                    if ((xhr.status >= 200 && xhr.status < 400) || xhr.status == 304) {
                        img_url = "https://api.tomys.top/api/acgimg";
                        load_img(img_url);
                    }
                    break;
            }
        }
        xhr.open('get', 'https://api.tomys.top/api/acgimg');
        xhr.send(null);
    }

    function RandomNumBoth(Min, Max) {
        var Range = Max - Min;
        var Rand = Math.random();
        var num = Min + Math.round(Rand * Range);
        return num;
    }

    function load_img(url) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.onprogress = function(event) {
            if (event.lengthComputable) {
                document.getElementById("loadingStatus").style = 'width: 100%;';
            }
        };
        xhr.onreadystatechange = function() {
            switch (xhr.readyState) {
                case 4:
                    if ((xhr.status >= 200 && xhr.status < 300) || xhr.status == 304) {
                        get_image_size(url);
                    } else {
                        mdui.alert(name + "抱歉，图片加载失败！");
                    }
            }
        };
        xhr.send();
    }

    function get_image_size(url) {
        var img = new Image();
        img.src = url;
        img.onerror = function() {
            mdui.alert("抱歉，图片加载失败！");
            return false;
        };

        if (img.complete) {
            display_image(url, img);
        } else {
            img.onload = function() {
                display_image(url, img);
                img.onload = null;
            }
        }
    }

    function display_image(url, img) {
        document.getElementById("imgBox").style = "max-width: " + img.width + 'px;';
        document.getElementById("imgSrc").src = url;
        document.getElementById("Remind").innerHTML = '';
    }
</script>