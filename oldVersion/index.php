<?php
include('config.php');
include('function.php');
error_reporting(0);
try{
    $pdo = pdoConnect();
    $databaseQuery = databaseQuery($pdo, "code", str_replace("/","",$_GET['c']));
} catch (Exception $e) {
    ?>
    <!DOCTYPE html>
    <head>
        <meta charset="UTF-8">
        <style>
            a{
            text-decoration:none;
            color:#4D4D4D;
            }
            .one{ font-weight: normal; }
            .two{ font-weight: bold; }
            .three{ font-weight: 200; }
        </style>
        <title><?php echo $TITLE?></title>
    </head>
    <body>
        <center>
            <h1 class="one">抱歉！出错啦！</h1>
            <h2 class="three">连接数据库似乎出现了一个致命的错误</h2>
        </center>
    </body>
    <?  
    exit();
}
if($databaseQuery['num']!=0){
    if($JUMP_TIME>0){
        include('jump.php');
        exit();
    } else {
        header('HTTP/1.1 301 Moved Permanently');
        header('Location: '.$databaseQuery['result'][0]['url']);//
    }
}


?>

<!DOCTYPE html>
<html>

<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width">
    <title><?php echo $TITLE?> - 荼蘼网络</title>
    <link rel="shortcut icon" href="https://cdn.amoe.cc/web-static/private/tomyjan-website/common/img/favicon.ico">
    <link rel="stylesheet" href="https://cdn.amoe.cc/web-static/private/tomyjan-website/shorturl/background.css" />
    <link rel="stylesheet" href="https://cdn.amoe.cc/lib/mdui/latest/css/mdui.min.css" />
    <script src="https://cdn.amoe.cc/lib/jquery/latest/jquery.min.js"></script>
    <script defer src="https://umami.amoe.cc/script.js" data-website-id="d787de1d-a88e-4a9e-b6d9-7da3c9783d47"></script>
    <style>
        a{
            text-decoration:none
        }
        .hide {
            position: inherit;
            width: 10PX;
            height: calc(20vh);
        }
    </style>
    
    <!-- Global site tag (gtag.js) - Google Analytics -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-N194P9LRRJ"></script>
    <script>
        window.dataLayer = window.dataLayer || [];
        function gtag(){dataLayer.push(arguments);}
        gtag('js', new Date());
        
        gtag('config', 'G-N194P9LRRJ');
    </script>
    
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-3486166483876303" crossorigin="anonymous"></script>

</head>

<body class="mdui-appbar-with-toolbar  mdui-theme-primary-pink mdui-theme-accent-pink">

    <div class="mdui-container " style="max-width: 400px; ">
        <div class="hide">
        </div>
        <div class="mdui-card" style="border-radius: 16px;">
            <div class="mdui-card-media">
                <div class="mdui-card-menu">
                </div>
            </div>
            <div class="mdui-card-primary">
                <div class="mdui-card-primary-title">Zi5 短链</div>
                <div class="mdui-card-primary-subtitle">方便快捷的短链接工具!</div>
                <div><font size=4 color=red>本站暂时关闭游客生成短链, 请谅解!</font></div>
            </div>
            <div class="mdui-card-content">
                <div class="mdui-textfield">
                    <label class="mdui-textfield-label">需要生成短链的网址</label>
                    <input class="mdui-textfield-input" id="url" placeholder="https://www.tomys.top" type="text" />
                </div>
                <br>
            </div>
            <div class="mdui-card-actions">
                <button class="mdui-btn mdui-color-theme-accent mdui-ripple mdui-float-right" id="submitbtn" onclick='submit()' style="border-radius: 10px;">生成短链</button>
            </div>
            
        </div>
        <br /><br />
        
        <footer>
            <center><p style="color:#66CCFF;">&copy; <a style="color:#66CCFF;" target="_blank" href="https://www.tomys.top/">TomyJan</a></p><p style="color:#66CCFF;"> <a style="color:#66CCFF;" target="_blank" href="https://icp.gov.moe/?keyword=20215432" target="_blank">萌ICP备20215432号</a> | <a style="color:#66CCFF;" href="https://beian.miit.gov.cn/" target="_blank">鲁ICP备2021003464号-15</a></p></center>
        </footer>

    </div>

    <script src="https://cdn.amoe.cc/lib/mdui/latest/js/mdui.min.js"></script>
    <script>
        function submit() {
            $("#submitbtn").attr("disabled", true);
            url = $("#url").val();
            if (<?php if($IMAGE_VERIFICATION) echo 'true'; else echo 'false'; ?>) {
                imageVerification(function(answer) {
                    request(url, answer)
                })
            } else {
                request(url, '0000');
            }

        }

        function imageVerification(callback) {
            mdui.dialog({
                title: '请输入图片中的验证码',
                content: '<center><div class="mdui-row"> <div class="mdui-col-xs-9"> <div class="mdui-textfield"> <input class="mdui-textfield-input" id="answer" type="text" placeholder="请输入您的答案" /></div> </div> <div class="mdui-col-xs-3"> <img style="position: relative;top:15px" id="vcode" src="./vcode.php" /> </div> </div></center>',
                modal: true,
                buttons: [{
                        text: '取消'
                    },
                    {
                        text: '确认',
                        onClick: function(inst) {
                            callback(document.getElementById('answer').value);
                        }
                    }
                ]
            });
        }

        function request(url, answer) {
            $.ajax({
                type: 'post',
                url: './submit.php',
                data: {
                    url: url,
                    code: answer,
                },
                dataType: 'text',
                success: function(data) {
                    console.log(data)
                    data = JSON.parse(data);
                    if (data.code == 1) {
                        mdui.alert('<div class="mdui-typo">您的短链接为：<a href="'+data.result+'" target="_blank">'+data.result+'</a></div>', '生成成功');
                        $("#url").val("");
                    } else {
                        mdui.snackbar({
                            message: data.msg,
                            position: 'right-top'
                        });
                    }
                    $("#submitbtn").attr("disabled", false);
                },
                error: function(data) {
                    var errors = data.responseJSON;
                    $.each(errors.errors, function(key, value) {
                        mdui.snackbar({
                            message: "出现了一个未知错误",
                            position: 'right-top'
                        });
                    });
                },
            });
        }
    </script>
    <div id="background">
        <div class="bg-image" style="background: url('https://cdn.amoe.cc/web-static/private/tomyjan-website/common/img/blog-background_dark.jpg') no-repeat center center; display: block;"></div>
    </div>
</body>

</html>