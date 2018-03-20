'use strict'

exports.wsEventType = [
  'log',
  'cmdRet',
  'userEvent',
  'sysEvent',
]

exports.userEvents = [
  'qrcode', // 登陆二维码
  'scan', // 扫码登陆状态
  'login', // 登陆完成
  'loaded', // 通讯录载入完毕
  'logout', // 注销登录（账户退出）
  'close', // 任务断线
  'warn', // 错误
  'sns', // 朋友圈事件（朋友圈小圆点）
  // 'push', // 推送消息（系统、好友消息、联系人等）
]

exports.loginType = {
  token   : 'token',     // 断线重连
  request : 'request',   // 二次登陆
  qrcode  : 'qrcode',    // 扫码登陆
  phone   : 'phone',     // 手机验证码登陆
  user    : 'user',      // 账号密码登陆
}

exports.blacklist = [
  'weixin', // 腾讯团队
  'newsapp', // 腾讯新闻
  'tmessage', //
  'fmessage', // 朋友推荐
  'qmessage', // qq离线消息
  'floatbottle', // 漂流瓶
  'medianote', // 语音记事本
  'mphelper', // 公众平台安全助手
  'weibo', // 微博-未知
]
