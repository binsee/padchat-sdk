'use strict'

const EventEmitter = require('events')
const Websocket    = require('ws')
const UUID         = require('uuid')

const Helper = require('./helper')
const {
  wsEventType,
  loginType,
  blacklist,
} = require('./define')

const server = 'ws://127.0.0.1:7777'

/**
 * Padchat模块
 *
 * 使用websocket与服务器进行通讯，拥有以下事件
 *
 * qrcode 推送的二维码
 * scan 扫码状态
 * push 新信息事件
 * login 登录
 * loaded 通讯录载入完毕
 * logout 注销登录
 * over 实例注销（账号不退出）（要再登录需要重新调用init）
 * warn 错误信息
 * sns 朋友圈更新事件
 *
 * 所有接口均返回以下结构数据：
 * {
 * success: true,   // 执行是否成功
 * err    : '',     // 错误提示
 * msg    : '',     // 附加信息
 * data   : {}      // 返回结果
 * }
 *
 * @class Padchat
 * @extends {EventEmitter}
 */
class Padchat extends EventEmitter {
  /**
   * Creates an instance of Padchat.
   * @param {string} url 服务器
   * @param {object} [opts={}] 附加参数
   * url 服务器url
   * debug 开启调试模式
   * qurey 连接服务器时附加参数
   * transports 与服务器通讯模式，不建议更改
   * sendTimeout 操作的超时时间，单位为秒
   * @memberof Padchat
   */
  constructor(url = server, opts = {}) {
    super()
    this._event = new EventEmitter()
    // 向ws服务器提交指令后，返回结果的超时时间，单位毫秒
    this.sendTimeout = 10 * 1000

    this.ws = new Websocket(url)
    this.ws
      .on('message', msg => {
        onWsMsg.call(this, msg)
      })
      .on('open', () => { this.emit('open') })
      .on('close', () => { this.emit('close') })
      .on('error', e => { this.emit('error', e) })
  }

  /**
  * ws发送数据
  *
  * @param {object} data 数据
  * @returns {Promise} 返回ws处理结果
  * @memberof Wss
  */
  async _send(data) {
    return new Promise((resolve, reject) => {
      this.ws.send(JSON.stringify(data), e => {
        if (e) {
          reject(new Error(`ws发送数据失败! err: ${e.message}`))
        } else {
          resolve(true)
        }
      })
    })
  }

  /**
  * 包装ws发送数据
  *
  * @param {object} data 要发送的数据
  * @param {number} timeout 发送超时时间
  * @returns {Promise} 返回ws处理结果
  * @memberof Wss
  */
  async asyncSend(data, timeout = 30000) {
    if (!data.cmdId) {
      data.cmdId = UUID.v1()
    }
    return new Promise((res, rej) => {
      try {
        getCmdRecv.call(this, data.cmdId, timeout)
          .then(data => {
            // console.info('getCmdRecv ret data:', data)
            res(data.data)
          })
        this._send(data)
          .then(async ret => {
            // console.info('asyncSend ret: %s', ret)
            return ret
          })
      } catch (e) {
        rej(e)
      }
    })
  }

  /**
  * 包装ws发送指令数据包
  *
  * @param {string} cmd 要操作的接口
  * @param {object} data 要发送的数据
  * @returns {Promise} 返回ws处理结果
  */
  async sendCmd(cmd, data = {}) {
    if (data.rawMsgData) {
      // 清洗掉无用而占空间的字段
      data.rawMsgData = clearRawMsg(data.rawMsgData)
      data.rawMsgData = Helper.toUnderLine(data.rawMsgData)
    }

    return await this.asyncSend({
      type: 'user',
      cmd,
      data,
    })
      .then(ret => {
        // 用于抓取操作接口对应的返回数据，便于写入文档
        this.emit('cmdRet', cmd, ret)
        return ret
      })
      .catch(e => {
        throw e
      })
  }

  /**
  * 初始化
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true
  }
  * ```
  * @memberof Padchat
  */
  async init() {
    return await this.sendCmd('init')
  }

  /**
  * 关闭微信实例（不退出登陆）
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async close() {
    return await this.sendCmd('close')
  }

  /**
  * 登录账号
  *
  * @param {string} [type='qrcode'] 登录类型，默认为扫码登录
  * token 断线重连，用于短时间使用设备数据和token再次登录。token有效期很短，如果登陆失败，建议使用二次登陆方式
  * request 二次登陆。需要提供`wxData`和`token`数据，手机端会弹出确认框，点击后登陆。不容易封号
  * qrcode 扫码登录（现在此模式已经可以返回二维码内容的url了）
  * phone 使用手机验证码登录
  * user 使用账号+密码登录
  * @param {Object} data 附加数据
  * 登录类型 | 字段 | 说明
  * ----|----|----
  * 任意 | wxData | 设备信息数据，登录后使用 getDeviceInfo接口获得。使用此数据可免设备安全验证，不容易封号
  * token/request | token | 使用用任意方式登录成功后，使用 getAutoLoginData 接口获得。 此token有过期时间，断开登录状态一段时间后会过期。
  * phone | phone | 手机号
  * phone | code | 手机验证码
  * user | username | 用户名/qq号/手机号
  * user | password | 密码
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    msg    : '请使用手机微信扫码登陆！',
    success: true
  }
  * ```
  * @memberof Padchat
  */
  async login(type = 'qrcode', data = {}) {
    if (!loginType[type]) {
      throw new Error('login type error!')
    }

    switch (type) {
      case 'token'  : 
      case 'request': 
        if (!data.token || !data.wxData) {
          throw new Error('login data error!')
        }
        break
      case 'phone': 
        if (!data.phone) {
          // code
          throw new Error('login data error!')
        }
        break
      case 'user': 
        if (!data.username || !data.password) {
          throw new Error('login data error!')
        }
        break
      default: 
        break
    }
    data.loginType = loginType[type]
    return await this.sendCmd('login', data)
  }

  /**
  * 获取设备62数据
  *
  * NOTE: 注意：如果使用62数据进行登陆，再获取到的62数据是无效的，一定不要用。
  * 事实上，只要你有一次登陆成功，以后一直用这个62数据，不用换就行。
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : 
      {
        wxData: '62xxxxx'  //设备62数据
      }
  }
  * ```
  * @memberof Padchat
  */
  async getWxData() {
    return await this.sendCmd('getWxData', {})
  }

  /**
  * 获取二次登陆数据
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        message: '',
        status : 0,
        token  : 'xxxx',   //二次登陆token
        uin    : 14900000  //微信号uin，唯一值
      }
  }
  * ```
  * @memberof Padchat
  */
  async getLoginToken() {
    return await this.sendCmd('getLoginToken', {})
  }

  /**
   * 同步通讯录
   * FIXME: 此接口不可用，待修复
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async syncContact() {
    return await this.sendCmd('syncContact', {})
  }

  /**
  * 退出登录
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async logout() {
    return await this.sendCmd('logout', {})
  }

  /**
  * 发送文字信息
  *
  * @param {String} toUserName 接收者的wxid
  * @param {String} content 内容文本
  * @param {any} [atList=[]] 向群内发信息时，要@的用户wxid数组
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : {
      message: '',
      msgId  : '5172746684759824075',
      status : 0
    }
  }
  * ```
  *  @memberof Padchat
  */
  async sendMsg(toUserName, content, atList = []) {
    return await this.sendCmd('sendMsg', {
      toUserName,
      content,
      atList,
    })
  }

  /**
  * 群发文字信息
  *
  * FIXME: 此接口有问题，暂停使用
  *
  * @param {any} [userList=[]] 接收者wxid数组
  * @param {String} content 内容文本
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async massMsg(userList = [], content) {
    return new Error('此接口存在问题，停用!')
    // return await this.sendCmd('massMsg', {
    //   userList,
    //   content,
    // })
  }

  /**
  * 发送App消息
  *
  * @param {String} toUserName 接收者的wxid
  * @param {Object} object 内容文本
  * ```
  * {
  * appid    = '',   //appid，忽略即可
  * sdkver   = '',   //sdk版本，忽略即可
  * title    = '',   //标题
  * des      = '',   //描述
  * url      = '',   //链接url
  * thumburl = '',   //缩略图url
  * }
  * ```
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : {
      message: '',
      msgId  : '2195811529497100215',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async sendAppMsg(toUserName, object) {
    const content = Helper.structureXml(object)
    return await this.sendCmd('sendAppMsg', {
      toUserName,
      content,
    })
  }

  /**
  * 分享名片
  *
  * @param {String} toUserName 接收者的wxid
  * @param {String} content 内容文本
  * @param {String} userId 被分享人wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : {
      message: '',
      msgId  : '1797099903789182796',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async shareCard(toUserName, content, userId) {
    return await this.sendCmd('shareCard', {
      toUserName,
      content,
      userId,
    })
  }

  /**
  * 发送图片消息
  *
  * @param {String} toUserName 接收者的wxid
  * @param {Buffer|String} file 图片Buffer数据或base64
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : {
      message: '',
      msgId  : '1797099903789182796',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async sendImage(toUserName, file) {
    if (file instanceof Buffer) {
      file = file.toString('base64')
    }
    return await this.sendCmd('sendImage', {
      toUserName,
      file,
    })
  }

  /**
  * 发送语音消息
  * 注意：只能发送silk格式的语音文件
  *
  * @param {String} toUserName 接收者的wxid
  * @param {Buffer|String} file 语音Buffer数据或base64
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error: '', success: true,
    data : {
      data   : 2490,                   //语音文件尺寸
      message: '',
      msgId  : '136722815749654341',
      size   : 0,
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async sendVoice(toUserName, file) {
    if (file instanceof Buffer) {
      file = file.toString('base64')
    }
    return await this.sendCmd('sendVoice', {
      toUserName,
      file,
    })
  }

  /**
  * 获取消息原始图片
  *
  * 在push事件中收到的data数据是缩略图图片数据，使用本接口获取原图数据
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        image  : 'base64_xxxx',   //base64编码的原图数据
        message: '',
        size   : 8139,            //图片数据尺寸
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async getMsgImage(rawMsgData) {
    return await this.sendCmd('getMsgImage', {
      rawMsgData,
    })
  }

  /**
  * 获取消息原始视频
  *
  * 在push事件中只获得推送通知，不包含视频数据，需要使用本接口获取视频文件数据
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        message: '',
        size   : 160036,        //视频数据尺寸
        status : 0,
        video  : 'base64_xxxx'  //base64编码的视频数据
      }
  }
  * ```
  * @memberof Padchat
  */

  async getMsgVideo(rawMsgData) {
    return await this.sendCmd('getMsgVideo', {
      rawMsgData,
    })
  }

  /**
  * 获取消息语音数据
  *
  * 这个接口获取到的与push事件中接收到的数据一致，是base64编码的silk格式语音数据
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        message: '',
        size   : 2490,          //语音数据尺寸
        status : 0,
        voice  : 'base64_xxxx'  //base64编码的语音数据
      }
  }
  * ```
  * @memberof Padchat
  */
  async getMsgVoice(rawMsgData) {
    return await this.sendCmd('getMsgVoice', {
      rawMsgData,
    })
  }

  /**
  * 创建群
  *
  * 注意：如果有用户存在问题不能进群，则会建群失败。
  * 但判断是否成功应以`userName`字段
  *
  * @param {String[]} userList 用户wxid数组
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        message : 'Everything is OK',    //操作结果提示，失败为`MemberList are wrong`
        status  : 0,
        userName: '5658541000@chatroom'  //如果建群成功，则返回群id
      }
  }
  * ```
  * @memberof Padchat
  */
  async createRoom(userList) {
    return await this.sendCmd('createRoom', {
      userList,
    })
  }

  /**
  * 获取群成员信息
  *
  * @param {String} groupId 群id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        chatroomId: 700000001,
        count     : 3,
        member    :             //群成员列表json文本，需要再使用JSON.parse进行解析
        '[{"big_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/0","chatroom_nick_name":"","invited_by":"wxid_xxx002","nick_name":"杉木","small_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/132","user_name":"wxid_xxx001"},{"big_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/0","chatroom_nick_name":"","invited_by":"","nick_name":"小木匠","small_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/132","user_name":"wxid_xxx002"},{"big_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/0","chatroom_nick_name":"","invited_by":"wxid_xxx002","nick_name":"梦君君","small_head":"http://wx.qlogo.cn/mmhead/ver_1/xxx/132","user_name":"wxid_xxx003"}]\n',
        message : '',
        status  : 0,
        userName: '5658541000@chatroom'  //群id
      }
  }
  * ```
  * @memberof Padchat
  */
  async getRoomMembers(groupId) {
    return await this.sendCmd('getRoomMembers', {
      groupId,
    })
  }

  /**
  * 添加群成员
  *
  * @param {String} groupId 群id
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: 'Everything is OK',   //失败为`MemberList are wrong`
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async addRoomMember(groupId, userId) {
    return await this.sendCmd('addRoomMember', {
      groupId,
      userId,
    })
  }

  /**
  * 邀请群成员
  * 会给对方发送一条邀请消息，无法判断对方是否真的接收到
  *
  * @param {String} groupId 群id
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async inviteRoomMember(groupId, userId) {
    return await this.sendCmd('inviteRoomMember', {
      groupId,
      userId,
    })
  }

  /**
  * 删除群成员
  *
  * @param {String} groupId 群id
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async deleteRoomMember(groupId, userId) {
    return await this.sendCmd('deleteRoomMember', {
      groupId,
      userId,
    })
  }

  /**
  * 退出群
  *
  * @param {String} groupId 群id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async quitRoom(groupId) {
    return await this.sendCmd('quitRoom', {
      groupId,
    })
  }

  /**
  * 设置群公告
  *
  * @param {String} groupId 群id
  * @param {String} content 群公告内容
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async setRoomAnnouncement(groupId, content) {
    return await this.sendCmd('setRoomAnnouncement', {
      groupId,
      content,
    })
  }

  /**
  * 设置群名称
  *
  * @param {String} groupId 群id
  * @param {String} content 群名称
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async setRoomName(groupId, content) {
    return await this.sendCmd('setRoomName', {
      groupId,
      content,
    })
  }

  /**
  * 获取微信群二维码
  *
  * @param {String} groupId 群id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        footer : '该二维码7天内(4月13日前)有效，重新进入将更新',
        message: '',
        qrCode : '',                            //进群二维码图片base64
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async getRoomQrcode(groupId) {
    return await this.sendCmd('getRoomQrcode', {
      groupId,
      style: 0,
    })
  }

  /**
  * 获取用户信息
  *
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        bigHead        : 'http://wx.qlogo.cn/xxx/0',     //大头像url
        city           : 'mesa',                         //城市
        country        : 'CN',                           //国家
        intro          : '',                             //简介（公众号主体）
        label          : '',                             //（标签）
        message        : '',
        nickName       : '杉木',                           //昵称
        provincia      : 'Henan',                        //省份
        pyInitial      : 'SM',                           //昵称拼音简写
        quanPin        : 'shamu',                        //昵称拼音
        remark         : '',                             //备注
        remarkPyInitial: '',                             //备注拼音简写
        remarkQuanPin  : '',                             //备注拼音
        sex            : 1,                              //性别：1男2女
        signature      : '签名',                           //个性签名
        smallHead      : 'http://wx.qlogo.cn/xxx/132',   //小头像url
        status         : 0,
        stranger       : 'v1_xxx@stranger',              //用户v1码，从未加过好友则为空
        ticket         : 'v2_xxx@stranger',              //用户v2码，如果非空则为单向好友(非对方好友)
        userName       : 'binxxx'                        //用户wxid
      }
  }
  * ```
  * @memberof Padchat
  */
  async getContact(userId) {
    return await this.sendCmd('getContact', {
      userId,
    })
  }

  /**
  * 搜索用户
  * 可用此接口来判断是否已经加对方为好友
  *
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        bigHead  : 'http://wx.qlogo.cn/xxx/0',     //大头像url
        city     : 'mesa',                         //城市
        country  : 'CN',                           //国家
        message  : '',
        nickName : '杉木',                           //昵称
        provincia: 'Henan',                        //省份
        pyInitial: 'SM',                           //昵称拼音简写
        quanPin  : 'shamu',                        //昵称拼音
        sex      : 1,                              //性别：1男2女
        signature: '签名',                           //个性签名
        smallHead: 'http://wx.qlogo.cn/xxx/132',   //小头像url
        status   : 0,
        stranger : 'v1_xxx@stranger',              //好友为空，非好友显示v2码
        userName : 'binxxx'                        //是自己好友显示wxid，非好友为v1码
      }
  }
  * ```
  * @memberof Padchat
  */
  async searchContact(userId) {
    return await this.sendCmd('searchContact', {
      userId,
    })
  }

  /**
  * 删除好友
  *
  * @param {String} userId 用户wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async deleteContact(userId) {
    return await this.sendCmd('deleteContact', {
      userId,
    })
  }

  /**
  * 获取用户二维码
  * 仅限获取自己的二维码，无法获取其他人的二维码
  *
  * @param {String} userId 用户wxid
  * @param {Number} style 二维码风格。可用范围0-3
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        footer : '',
        message: '',
        qrCode : '',   //二维码图片base64
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async getContactQrcode(userId, style = 0) {
    return await this.sendCmd('getUserQrcode', {
      userId,
      style,
    })
  }

  /**
  * 通过好友验证
  *
  * @param {String} stranger 用户stranger数据
  * @param {String} ticket 用户ticket数据
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async acceptUser(stranger, ticket) {
    return await this.sendCmd('acceptUser', {
      stranger,
      ticket,
    })
  }

  /**
  * 添加好友
  *
  * @param {String} stranger 用户stranger数据
  * @param {String} ticket 用户ticket数据
  * @param {Number} type 添加好友途径
  × 值 | 说明
  × ----|----
  x 0 | 通过微信号搜索
  × 1 | 搜索QQ号
  x 3 | 通过微信号搜索
  × 4 | 通过QQ好友添加
  × 5 | 通过朋友验证消息
  × 8 | 通过群聊
  × 10 | 通过手机通讯录添加
  × 12 | 来自QQ好友
  × 13 | 通过手机通讯录添加
  × 14 | 通过群聊
  × 15 | 通过搜索手机号
  × 17 | 通过名片分享           //未验证
  × 22 | 通过摇一摇打招呼方式    //未验证
  × 25 | 通过漂流瓶             //未验证
  × 30 | 通过二维码方式         //未验证
  * @param {string} [content=''] 验证信息
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0    //如果对方设置了验证，会返回-44
    }
  }
  * ```
  * @memberof Padchat
  */
  async addContact(stranger, ticket, type = 3, content = '') {
    return await this.sendCmd('addContact', {
      stranger,
      ticket,
      type,
      content,
    })
  }

  /**
  * 打招呼
  * 如果已经是好友，会收到由系统自动发送，来自对方的一条文本信息
  * “xx已通过你的朋友验证请求，现在可以开始聊天了”
  *
  * @param {String} stranger 用户stranger数据
  * @param {String} ticket 用户ticket数据
  * @param {String} content 打招呼内容
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async sayHello(stranger, ticket, content = '') {
    return await this.sendCmd('sayHello', {
      stranger,
      ticket,
      content,
    })
  }

  /**
  * 设置备注
  *
  * @param {String} userId 用户wxid
  * @param {String} remark 备注名称
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async setRemark(userId, remark) {
    return await this.sendCmd('setRemark', {
      userId,
      remark,
    })
  }

  /**
  * 设置头像
  *
  * @param {Buffer|String} file 图片Buffer数据或base64
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
    {
      success: true,
      data   : 
        {
          bigHead  : 'http://wx.qlogo.cn/mmhead/ver_1/xxx/0',
          data     : 1527,                                        //图片文件尺寸
          message  : '',
          size     : 1527,                                        //图片文件尺寸
          smallHead: 'http://wx.qlogo.cn/mmhead/ver_1/xxx/132',
          status   : 0
        }
    }
  * ```
  * @memberof Padchat
  */
  async setHeadImg(file) {
    if (file instanceof Buffer) {
      file = file.toString('base64')
    }
    return await this.sendCmd('setHeadImg', {
      file,
    })
  }

  /** 朋友圈系列接口 */

  /**
  * 上传图片到朋友圈
  * NOTE: 此接口只能上传图片，并不会将图片发到朋友圈中
  *
  * @param {Buffer|String} file 图片Buffer数据或base64
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
    {
      success: true,
      data   : 
        {
          bigHead  : 'http://mmsns.qpic.cn/mmsns/xxx/0',
          data     : 1527,                                   //图片文件尺寸
          message  : '',
          size     : 1527,                                   //图片文件尺寸
          smallHead: 'http://mmsns.qpic.cn/mmsns/xxx/150',
          status   : 0
        }
    }
  * ```
  * @memberof Padchat
  */
  async snsUpload(file) {
    if (file instanceof Buffer) {
      file = file.toString('base64')
    }
    return await this.sendCmd('snsUpload', {
      file,
    })
  }

  /**
  * 操作朋友圈
  *
  * @param {String} momentId 朋友圈信息id
  * @param {Number} type 操作类型，1为删除朋友圈，4为删除评论，5为取消赞
  * @param {Number} commentId 操作类型，当type为4时，对应删除评论的id，其他状态为0
  * @param {Number} commentType 操作类型，当删除评论时可用，需与评论type字段一致
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async snsObjectOp(momentId, type, commentId, commentType = 2) {
    return await this.sendCmd('snsObjectOp', {
      momentId,
      type,
      commentId,
      commentType,
    })
  }

  /**
  * 发朋友圈
  *
  * @param {String} content 内容文本
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        data: 
          {
            create_time: 1523015689,
            description:              //朋友圈信息xml结构体文本
            '<TimelineObject><id>12775981595019653292</id><username>wxid_8z66rux8lysr22</username><createTime>1523015689</createTime><contentDesc>来自代码发的朋友圈</contentDesc><contentDescShowType>0</contentDescShowType><contentDescScene>3</contentDescScene><private>0</private><sightFolded>0</sightFolded><appInfo><id></id><version></version><appName></appName><installUrl></installUrl><fromUrl></fromUrl><isForceUpdate>0</isForceUpdate></appInfo><sourceUserName></sourceUserName><sourceNickName></sourceNickName><statisticsData></statisticsData><statExtStr></statExtStr><ContentObject><contentStyle>2</contentStyle><title></title><description></description><mediaList></mediaList><contentUrl></contentUrl></ContentObject><actionInfo><appMsg><messageAction></messageAction></appMsg></actionInfo><location poiClassifyId="" poiName="" poiAddress="" poiClassifyType="0" city=""></location><publicUserName></publicUserName><streamvideo><streamvideourl></streamvideourl><streamvideothumburl></streamvideothumburl><streamvideoweburl></streamvideoweburl></streamvideo></TimelineObject>',
            id       : '12775981595019653292',   //朋友圈信息id
            nick_name: '小木匠',
            user_name: 'wxid_xxxx'
          },
        message: '',
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async snsSendMoment(content) {
    return await this.sendCmd('snsSendMoment', {
      content,
    })
  }

  /**
  * 查看用户朋友圈
  *
  * @param {String} userId 用户wxid
  * @param {string} [momentId=''] 朋友圈信息id
  * 首次传入空即获取第一页，以后传入上次拉取的最后一条信息id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        count: 1,
        data :     //朋友圈信息结构数组（无评论和点赞数据）
          [{
            create_time: 1523015689,
            description: '<TimelineObject><id>12775981595019653292</id><username>wxid_xxx</username><createTime>1523015689</createTime><contentDesc>来自代码发的朋友圈</contentDesc><contentDescShowType>0</contentDescShowType><contentDescScene>3</contentDescScene><private>0</private> <sightFolded>0</sightFolded> <appInfo><id></id><version></version><appName></appName><installUrl></installUrl><fromUrl></fromUrl><isForceUpdate>0</isForceUpdate></appInfo> <sourceUserName></sourceUserName> <sourceNickName></sourceNickName> <statisticsData></statisticsData> <statExtStr></statExtStr> <ContentObject><contentStyle>2</contentStyle><title></title><description></description><mediaList></mediaList><contentUrl></contentUrl></ContentObject> <actionInfo><appMsg><messageAction></messageAction></appMsg></actionInfo> <location poiClassifyId="" poiName="" poiAddress="" poiClassifyType="0" city=""></location> <publicUserName></publicUserName> <streamvideo><streamvideourl></streamvideourl><streamvideothumburl></streamvideothumburl><streamvideoweburl></streamvideoweburl></streamvideo></TimelineObject> ',
            id         : '12775981595019653292',
            nick_name  : '小木匠',
            user_name  : 'wxid_xxx'
          }],
        message: '',
        page   : '81cb2ad01ebc219f',
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async snsUserPage(userId, momentId = '') {
    return await this.sendCmd('snsUserPage', {
      userId,
      momentId,
    })
  }

  /**
  * 查看朋友圈动态
  *
  * @param {string} [momentId=''] 朋友圈信息id
  * 首次传入空即获取第一页，以后传入上次拉取的最后一条信息id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : 
      {
        count: 1,
        data :     //朋友圈信息结构数组（无评论和点赞数据）
          [{
            create_time: 1523015689,
            description: '<TimelineObject><id>12775981595019653292</id><username>wxid_xxx</username><createTime>1523015689</createTime><contentDesc>来自代码发的朋友圈</contentDesc><contentDescShowType>0</contentDescShowType><contentDescScene>3</contentDescScene><private>0</private> <sightFolded>0</sightFolded> <appInfo><id></id><version></version><appName></appName><installUrl></installUrl><fromUrl></fromUrl><isForceUpdate>0</isForceUpdate></appInfo> <sourceUserName></sourceUserName> <sourceNickName></sourceNickName> <statisticsData></statisticsData> <statExtStr></statExtStr> <ContentObject><contentStyle>2</contentStyle><title></title><description></description><mediaList></mediaList><contentUrl></contentUrl></ContentObject> <actionInfo><appMsg><messageAction></messageAction></appMsg></actionInfo> <location poiClassifyId="" poiName="" poiAddress="" poiClassifyType="0" city=""></location> <publicUserName></publicUserName> <streamvideo><streamvideourl></streamvideourl><streamvideothumburl></streamvideothumburl><streamvideoweburl></streamvideoweburl></streamvideo></TimelineObject> ',
            id         : '12775981595019653292',
            nick_name  : '小木匠',
            user_name  : 'wxid_xxx'
          }],
        message: '',
        page   : '81cb2ad01ebc219f',
        status : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async snsTimeline(momentId = '') {
    return await this.sendCmd('snsTimeline', {
      momentId,
    })
  }

  /**
  * 获取朋友圈信息详情
  *
  * @param {String} momentId 朋友圈信息id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      data   : {},   //朋友圈信息结构
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async snsGetObject(momentId) {
    return await this.sendCmd('snsGetObject', {
      momentId,
    })
  }

  /**
  * 评论朋友圈
  *
  * @param {String} userId 用户wxid
  * @param {String} momentId 朋友圈信息id
  * @param {String} content 内容文本
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      data   : {},   //朋友圈信息结构
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */

  async snsComment(userId, momentId, content) {
    return await this.sendCmd('snsComment', {
      userId,
      momentId,
      content,
    })
  }

  /**
  * 朋友圈点赞
  *
  * @param {String} userId 用户wxid
  * @param {String} momentId 朋友圈信息id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    success: true,
    data   : {
      data   : {},   //朋友圈信息结构
      message: '',
      status : 0
    }
  }
  * ```
  * @memberof Padchat
  */
  async snsLike(userId, momentId) {
    return await this.sendCmd('snsLike', {
      userId,
      momentId,
    })
  }

  /** 收藏系列接口 */

  /**
  * 同步收藏消息
  *
  * @param {string} [favKey=''] 同步key
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async syncFav(favKey = '') {
    return await this.sendCmd('syncFav', {
      favKey,
    })
  }

  /**
  * 添加收藏
  *
  * @param {String} content 内容文本
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async addFav(content) {
    return await this.sendCmd('addFav', {
      content,
    })
  }

  /**
  * 获取收藏消息详情
  *
  * @param {Number} favId 收藏id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async getFav(favId) {
    return await this.sendCmd('getFav', {
      favId,
    })
  }

  /**
  * 删除收藏
  *
  * @param {Number} favId 收藏id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async deleteFav(favId) {
    return await this.sendCmd('deleteFav', {
      favId,
    })
  }

  /** 标签系列接口 */

  /**
  * 获取所有标签
  *
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async getLabelList() {
    return await this.sendCmd('getLabelList', {})
  }

  /**
  * 添加标签
  *
  * @param {String} label 标签名称
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async addLabel(label) {
    return await this.sendCmd('addLabel', {
      label,
    })
  }

  /**
  * 删除标签
  *
  * @param {String} labelId 标签id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async deleteLabel(labelId) {
    return await this.sendCmd('deleteLabel', {
      labelId,
    })
  }
  /**
  deleteLabel: {
  auth: 'tag',
  rule: {
  labelId: 'string',
  },
  },
  */

  /**
  * 设置用户标签
  *
  * @param {String} userId 用户wxid
  * @param {String} labelId 标签id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async setLabel(userId, labelId) {
    return await this.sendCmd('setLabel', {
      userId,
      labelId,
    })
  }

  /** 转账及红包接口 */

  /**
  * 查看转账消息
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        external: '{"trans_status":2001,"retcode":"0","retmsg":"ok","fee":20,"fee_type":"1","pay_time":152292100,"modify_time":1522922926,"refund_bank_type":"BANK","payer_name":"wxid_xxxxxx","receiver_name":"wxid_xxxxxx","status_desc":"已收钱","status_supplementary":"<_wc_custom_link_ href=\\"weixin:\\/\\/wcpay\\/transfer\\/watchbalance\\">查看零钱<\\/_wc_custom_link_>","delay_confirm_flag":0,"is_payer":false}',
        message : '\n',
        status  : 0
      }
  }
  * ```
  * 当未收款时 `external` 内容如下：
  * ```
    external: '{"trans_status":2000,"retcode":"0","retmsg":"ok","fee":20,"fee_type":"1","pay_time":152292100,"modify_time":0,"refund_bank_type":"BANK","payer_name":"wxid_xxxxxx","receiver_name":"wxid_xxxxxx","status_desc":"待确认收款","status_supplementary":"1天内未确认，将退还给对方。<_wc_custom_link_ href=\\"weixin:\\/\\/wcpay\\/transfer\\/rebacksendmsg\\">立即退还<\\/_wc_custom_link_>","delay_confirm_flag":0,"is_payer":false}',
  * ```
  * @memberof Padchat
  */
  async queryTransfer(rawMsgData) {
    return await this.sendCmd('queryTransfer', {
      rawMsgData,
    })
  }

  /**
  * 接受转账
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        external: '{"fee":20,"fee_type":"1","payer":"085e9858ea9393320da704000","receiver":"085e9858ebbb4c57b6f1ba000","retcode":"0","retmsg":"ok"}',
        message : '\n',
        status  : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async acceptTransfer(rawMsgData) {
    return await this.sendCmd('acceptTransfer', {
      rawMsgData,
    })
  }

  /**
  * 接收红包
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        external: '{"retcode":0,"retmsg":"ok","sendId":"1000039401201804056026435709000","wishing":"红包","isSender":1,"receiveStatus":2,"hbStatus":2,"statusMess":"","hbType":0,"watermark":"","agree_duty":{"title":"","service_protocol_wording":"","service_protocol_url":"","button_wording":"","delay_expired_time":0,"agreed_flag":1},"sendUserName":"wxid_xxxx","timingIdentifier":"D321E1FF9E302CC4A05BB75106F10000"}',
        key     : 'D321E1FF9E302CC4A05BB75106F10000',
        message : '\n',
        status  : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async receiveRedPacket(rawMsgData) {
    return await this.sendCmd('receiveRedPacket', {
      rawMsgData,
    })
  }

  /**
  * 查看红包信息
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @param {Number} [index=0] 列表索引。
  * 每页11个，查看第二页11，查看第三页22，以此类推
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        external: '{"retcode":0,"retmsg":"ok","recNum":0,"totalNum":1,"totalAmount":10,"sendId":"1000039401201804056026435709000","amount":0,"wishing":"红包","isSender":1,"receiveId":"","operationHeader":[],"hbType":0,"isContinue":0,"hbStatus":2,"headTitle":"红包金额0.10元，等待对方领取","canShare":0,"hbKind":1,"recAmount":0,"record":[],"operationTail":{"name":"未领取的红包，将于24小时后发起退款","type":"Text","content":"","enable":1,"iconUrl":"","ossKey":4294967000},"atomicFunc":{"enable":0},"jumpChange":1,"changeWording":"已存入零钱，可直接提现","sendUserName":"wxid_xxxxx"}',
        message : '\n',
        status  : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async queryRedPacket(rawMsgData, index = 0) {
    return await this.sendCmd('queryRedPacket', {
      rawMsgData,
      index,
    })
  }

  /**
  * 领取红包
  *
  * @param {Object} rawMsgData 推送的消息结构体
  * @param {String} key 红包的验证key，通过调用 receiveRedPacket 获得
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * ```
  {
    error  : '',
    success: true,
    data   : 
      {
        external: '{"retcode":0,"retmsg":"ok","sendId":"1000039401201804057020330940000","amount":10,"recNum":1,"recAmount":10,"totalNum":1,"totalAmount":10,"hasWriteAnswer":0,"hbType":0,"isSender":0,"isContinue":0,"receiveStatus":2,"hbStatus":4,"statusMess":"","wishing":"测试好吧","receiveId":"1000039401000804057020330940000","headTitle":"","canShare":0,"operationHeader":[],"record":[{"receiveAmount":10,"receiveTime":"1522923952","answer":"","receiveId":"1000039401000804057020330940000","state":1,"receiveOpenId":"1000039401000804057020330940000","userName":"wxid_xxxxxxx"}],"watermark":"","jumpChange":1,"changeWording":"已存入零钱，可用于发红包","sendUserName":"binxxx","real_name_info":{"guide_flag":0},"SystemMsgContext":"<img src=\\"SystemMessages_HongbaoIcon.png\\"\\/>  你领取了$binxxx$的<_wc_custom_link_ color=\\"#FD9931\\" href=\\"weixin:\\/\\/weixinhongbao\\/opendetail?sendid=1000039401201804057020330940000&sign=92f26327088efd6eaeeb013fc2ad173515ab3be0305f09dcb43e3de7093805f0009089a4fe5e2f69ba87576d7fc33316b2faef1b406617d8578b3e4b064e7316159ff73cd39e730d7e974c8a5fc32b99&ver=6\\">红包<\\/_wc_custom_link_>","sessionUserName":"wxid_xxxxxx"}',
        message : '\n',
        status  : 0
      }
  }
  * ```
  * @memberof Padchat
  */
  async openRedPacket(rawMsgData, key) {
    return await this.sendCmd('openRedPacket', {
      rawMsgData,
      key,
    })
  }

  /** 公众号系列接口 */

  /**
  * 获取公众号gh名称
  *
  * @param {String} userId 公众号wxid
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async getMpInfo(userId) {
    return await this.sendCmd('getMpInfo', {
      userId,
    })
  }

  /**
  * 获取公众号信息
  *
  * @param {String} ghName 公众号gh名称，即`gh_`格式的id
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async getSubscriptionInfo(ghName) {
    return await this.sendCmd('getSubscriptionInfo', {
      ghName,
    })
  }

  /**
  * 操作公众号菜单
  *
  * @param {String} ghName 公众号gh名称，即`gh_`格式的id
  * @param {Number} menuId 菜单id
  * @param {String} menuKey 菜单key
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async operateSubscription(ghName, menuId, menuKey) {
    return await this.sendCmd('operateSubscription', {
      ghName,
      menuId,
      menuKey,
    })
  }

  /**
  * 获取网页访问授权
  *
  * @param {String} ghName 公众号gh名称，即`gh_`格式的id
  * @param {String} url 网页url
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async getRequestToken(ghName, url) {
    return await this.sendCmd('getRequestToken', {
      ghName,
      url,
    })
  }

  /**
  * 访问网页
  *
  * @param {string} url 网页url地址
  * @param {string} xKey 访问Key
  * @param {string} xUin 访问uin
  * @returns {Promise} 返回Promise<Object>，注意捕捉catch
  * @memberof Padchat
  */
  async requestUrl(url, xKey, xUin) {
    return await this.sendCmd('requestUrl', {
      url,
      xKey,
      xUin,
    })
  }
}

async function getCmdRecv(cmdId, timeout = 3000) {
  if (!cmdId) {
    throw new Error('未指定cmdID！')
  }
  cmdId = 'RET#' + cmdId
  // console.log('进入 getCmdRecv，应该监听: %s', cmdId)

  return new Promise((res, rej) => {
    // 如果某操作超过指定时间没有返回结果，则认为是操作超时
    const timeOutHandle = setTimeout(() => {
      this.removeAllListeners(cmdId)
      rej(new Error('等待指令操作结果超时！当前超时时间为:' + timeout * 1000))
    }, timeout * 1000)

    this.once(cmdId, data => {
      // console.log('监听到 %s 事件', cmdId, data)
      clearTimeout(timeOutHandle)
      res(data)
    })
  })
}


function onWsMsg(msg) {
  let data
  // console.log('进入 onWsMsg', msg)
  try {
    if (typeof msg === 'string') {
      data = JSON.parse(msg)
    } else {
      throw new Error('ws传输的数据不是字符串格式！')
    }
  } catch (e) {
    this.emit('error', new Error('解析msg数据失败: ' + e.message))
    return
  }

  if (data.data) {
    // 转小驼峰
    data.data = Helper.toCamelCase(data.data)
  }

  this.emit('msg', data)
  // 返回数据结果
  // data = {
  //   type  : 'cmdRet',                                 //返回数据包类型
  //   cmdId : 'b61eb250-3770-11e8-b00f-595f9d4f3df0',   //请求id
  //   taskId: '5',                                      //服务端返回当前实例的任务ID
  //   data  :                                           //荷载数据，`push`类型无
  //     {
  //       error  : '',     //错误提示
  //       msg    : '',     //其他提示信息
  //       success: true,   //接口执行是否成功
  //       data   :         //接口执行结果数据
  //         {
  //           message: '',
  //           msgId  : '1284778244346778513',
  //           status : 0
  //         }
  //     },
  //   list:   // 仅`push`类型拥有，包含多个push结构数据
  //     [
  //       {
  //         content    : '信息内容',                  //消息内容或xml结构体内容
  //         continue   : 1,
  //         description: '杉木 : 信息内容',             //描述内容
  //         fromUser   : 'wxid_001',              //发信人
  //         msgId      : '4032724472820776289',   //消息id
  //         msgSource  : '',
  //         msgType    : 5,                       //消息主类型，类型为5时则用子类型判断
  //         status     : 1,
  //         subType    : 1,                       //消息子类型
  //         timestamp  : 1522921008,              //消息时间戳
  //         toUser     : 'wxid_002',              //收件人
  //         uin        : 149806460,               //用户uin，全局唯一
  //         mType      : 1                        //消息类型。等同msgType，当msgType为5时，等同于subType
  //       }
  //     ],
  // }

  let hasOn
  switch (data.type) {
    case 'cmdRet': 
      if (data.type === 'cmdRet' && data.cmdId) {
        hasOn = this.emit('RET#' + data.cmdId, data)
        if (!hasOn) {
          this.emit('warn', new Error(`返回执行结果没有被监听！指令ID:${data.cmdId}`))
        }
      }
      break;

    case 'userEvent': 
      switch (data.event) {
        case 'warn': 
          // 如果success字段为true，则为不严重的问题
          this.emit('warn', new Error('服务器返回错误提示：' + data.error), data.success)
          break
        case 'qrcode':   // 微信扫码登陆，推送二维码
        case 'scan'  :   // 微信账号扫码事件
        case 'login' :   // 微信账号登陆成功
        case 'loaded':   // 通讯录载入完毕
        case 'logout':   // 微信账号退出
        case 'over'  :   // 实例注销（账号不退出）
        case 'sns'   :   // 朋友圈事件：新评论
          this.emit(data.event, data.data || {}, data.msg)
          break
        case 'push': 
          if (!data.data || !Array.isArray(data.data.list) || data.data.list.length <= 0) {
            this.emit('error', new Error('推送数据异常！'))
            break
          }
          data.data.list.forEach(item => {
            const type = item.msgType
            // 过滤无意义的2048和32768类型数据
            if (type === undefined || type === 2048 || type === 32768) {
              return null
            }
            // 当msg_type为5时，即表示推送的信息类型要用sub_type进行判断
            // 另外增加一个属性来存储好了
            item.mType = item.msgType === 5 ? item.subType : item.msgType
            this.emit('push', item)
          })
          break
        default: 
          this.emit('other', data)
          break
      }
      break
    default: 
      this.emit('other', data)
      break;
  }
}


function clearRawMsg(obj) {
  if (typeof obj === 'object') {
    delete obj.data
  }
  return obj
}


Padchat.Padchat   = Padchat
Padchat.blacklist = blacklist
module.exports    = Padchat
