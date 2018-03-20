# Padchat-sdk

## 说明

Padchat本地服务器的开发包。通过websocket协议与运行在windows平台上的微信ipad协议服务程序通讯，来登陆与操作微信。

## 开发说明

请勿将配套的exe程序泄露给非项目协作者使用，否则将封key并拒绝再参与内部开发。



## 通讯接口

### 1. 服务地址

地址： ws://api.batorange.com/ws

### 2. 通信协议

WebSocket 通信协议

* [websockets 官方github](https://github.com/websockets)
* [NodeJs 参考](https://github.com/websockets/ws)

#### 连接授权

后续更新。

#### API请求操作结果（识别异步请求）

由于websocket自身是异步操作，未原生支持识别请求返回的结果（即向服务端发送一个请求，服务端返回执行结果，客户端却无法确认是自己这个主动请求的结果，或者是另一个请求的返回结果，或者是服务端主动推送）。因此本服务增加了一个字段`cmdId`，用于标识请求，并在返回操作结果时一块返回。

如果希望发送api请求后，能识别服务端执行本次请求后的返回结果，可提供`cmdId`字段，请一定提供随机值，建议使用`uuid`模块随机生成。当收到服务端推送过来的数据中包含`cmdId`字段时，即可确认为之前请求对应的执行结果。
建议结合使用`Promise`+`Event.once(cmdId)`来实现。

#### 数据规则约定

> TODO：需要在sdk内统一字段命名，建议统一转换为`小驼峰`写法。

微信协议原生接口返回的所有数据字段名称下划线写法（如`user_name`）。

API请求的数据结构中，所有字段名称为`小驼峰`写法。

推送回来的数据结构中，第一级字段名称为`小驼峰`写法，`data`字段下所有字段名称为`下划线`写法。

### 3. API请求结构

API请求是以websocket协议发送的json数据，以下为json数据的字段

| **名称**   | **类型** | **描述**             | **必选** |
| --------- | ------   | ----------------    | ------ |
| type      | String   | 请求类型：`sys`/`user` | 是      |
| cmd      | String   | API命令             | 是      |
| cmdId      | String   | 指令id。用于识别API异步操作结果，操作结果会增加此属性推送回来  |  否      |
| data      | Object   | 取决于是不同的API要求  |  否      |

#### data字段总述

此部分为请求API指令时，需要附加的data数据。根据使用的API不同，需要提供不同的字段及对应数据。

字段名称 | 说明 | 备注
-----|----|---
**发送消息** | |
toUserName | 目标用户/群id | 群id包含@chatroom部分
content | 文本内容 | 文本消息内容<br>App消息xml结构体<br>名片自定义标题<br>添加好友时，为验证信息
image | 图片base64编码 | 发送图片消息<br>上传头像<br>朋友圈上传图片
atList | 要at的用户`数组` | `["wxid1","wxid2"]` <br>文本消息时有效
**群及好友管理** | |
roomName | 群名称
userIds | 用户id列表数组 | `["wxid1","wxid2"]` <br>创建群
chatroom | 要操作的群id
remark | 备注名称
userId | 要操作的用户id | 主动添加好友<br>好友验证<br>添加/邀请用户进入群
stranger | V1码，相对加密的userId | 接受好友请求(仅限stranger字段)<br>主动添加好友(也可使用`userId`字段)
ticket | V2码，好友请求中的ticket | 添加单向好友<br>接受好友请求
type | 添加好友来源 | `1`搜索QQ号；`2`邮箱搜索；`3`微信号；<br>`4`来自QQ好友；`8`通过群聊； `15`手机号<br>默认为 微信号
**其他** | |
rawMsgData | 原始MsgData数据（即接收到的push的data字段） | 接收红包<br>接收转账<br>获取原始图片（可删除掉json中的data字段减少数据量，即缩略图base64）

