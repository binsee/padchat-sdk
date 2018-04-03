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
 * msg    : '',     // 错误提示
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
      Helper.toUnderLine(data.rawMsgData)
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
   * NOTE: 需要注意使用断线重连方式登陆后，获取到的62数据是无效的，一定不要用。
   * 事实上，只要你有一次登陆成功，以后一直用这个62数据，不用换就行。
   *
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getWxData() {
    return await this.sendCmd('getWxData', {})
  }

  /**
   * 获取二次登陆数据
   *
   * 返回：
   * ```
   * {
   * error  : '',
   * msg    : '',
   * success: true,
   * data   : 
   *  {
   * message: '',
   * status : 0,
   * token  : 'xxxx',   //二次登陆token
   * uin    : 14900000  //微信号uin，唯一值
   *  }
   * }
   * ```
   *
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getLoginToken() {
    return await this.sendCmd('getLoginToken', {})
  }

  /**
   * 同步通讯录
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
   * @memberof Padchat
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
   * @param {any} [userList=[]] 接收者wxid数组
   * @param {String} content 内容文本
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async massMsg(userList = [], content) {
    return await this.sendCmd('massMsg', {
      userList,
      content,
    })
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
   * @param {Object} rawMsgData 推送的消息结构体
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {Object} rawMsgData 推送的消息结构体
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getMsgVideo(rawMsgData) {
    return await this.sendCmd('getMsgVideo', {
      rawMsgData,
    })
  }

  /**
   * 获取消息原始语音
   *
   * @param {Object} rawMsgData 推送的消息结构体
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {String[]} userList 用户wxid数组
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   *
   * @param {String} groupId 群id
   * @param {String} userId 用户wxid
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {Number} style 二维码风格
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getRoomQrcode(groupId, style = 1) {
    return await this.sendCmd('getRoomQrcode', {
      groupId,
      style,
    })
  }

  /**
   * 获取用户信息
   *
   * @param {String} userId 用户wxid
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getContact(userId) {
    return await this.sendCmd('getContact', {
      userId,
    })
  }

  /**
   * 搜索用户
   *
   * @param {String} userId 用户wxid
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @memberof Padchat
   */
  async deleteContact(userId) {
    return await this.sendCmd('deleteContact', {
      userId,
    })
  }

  /**
   * 获取用户二维码
   *
   * @param {String} userId 用户wxid
   * @param {Number} style 二维码风格
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async getContactQrcode(userId, style = 1) {
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
   × 1 | 朋友验证方式
   × 2 | 通过搜索邮箱
   × 3 | 通过微信号搜索
   × 4 | 通过QQ好友添加
   × 5 | 通过朋友验证消息
   × 7 | 通过朋友验证消息(可回复)
   × 8 | 通过群来源
   × 12 | 通过QQ好友添加
   × 14 | 通过群来源
   × 15 | 通过搜索手机号
   × 16 | 通过朋友验证消息
   × 17 | 通过名片分享
   × 22 | 通过摇一摇打招呼方式
   × 25 | 通过漂流瓶
   × 30 | 通过二维码方式
   * @param {string} [content=''] 验证信息
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   *
   * @param {String} stranger 用户stranger数据
   * @param {String} ticket 用户ticket数据
   * @param {String} content 打招呼内容
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   *
   * @param {Buffer|String} file 图片Buffer数据或base64
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * FIXME: 此接口有问题，暂时无效
   *
   * @param {String} momentId 朋友圈消息id
   * @param {Number} type 操作类型，1为删除朋友圈，4为删除评论，5为取消赞
   * @param {Number} commentId 操作类型，当type为4时，对应删除评论的id，其他状态为0
   * @param {Number} commentType 操作类型，当删除评论时可用，2或者3
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {string} [momentId=''] 朋友圈消息id
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {string} [momentId=''] 朋友圈消息id
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
   * @memberof Padchat
   */
  async snsTimeline(momentId = '') {
    return await this.sendCmd('snsTimeline', {
      momentId,
    })
  }

  /**
   * 获取朋友圈消息详情
   *
   * @param {String} momentId 朋友圈消息id
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {String} momentId 朋友圈消息id
   * @param {String} content 内容文本
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
   * @param {String} momentId 朋友圈消息id
   * @returns {Promise} 返回Promise<Object>，注意捕捉catch
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
    if (data.data.data) {
      data.data.data = Helper.toCamelCase(data.data.data || {})
    }
    //
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
  //     [{
  //     }],
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
          this.emit('warn', new Error('服务器返回错误提示：' + data.msg), data.success)
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
            const type = item.msg_type
            // 过滤无意义的2048和32768类型数据
            if (type === undefined || type === 2048 || type === 32768) {
              return null
            }
            // 当msg_type为5时，即表示推送的信息类型要用sub_type进行判断
            // 另外增加一个属性来存储好了
            item.mType = item.msg_type === 5 ? item.sub_type : item.msg_type
            this.emit('push', Helper.toCamelCase(item))
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
