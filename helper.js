'use strict'

// 将object中的属性名称转换为全驼峰格式


module.exports = {
  toCamelCase,
  toUnderLine,
}

/**
 * 将object中的属性名称从下划线转换为驼峰格式
 *
 * @param {any} obj 要转换的object
 * @param {boolean} [big=true] 是否转换为大驼峰格式
 * @returns 转换后的object
 */

function toCamelCase(obj, big = false) {
  if (!(obj instanceof Object)) {
    return obj
  }
  const newObj = {}
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      let newKey = key.replace(/_(\w)/g, (match, val, offset) => { return val.toUpperCase() })
      if (big) {
        newKey = newKey.replace(/^(\w)/, (match, val, offset) => { return val.toUpperCase() })
      }
      newObj[newKey] = obj[key]
    }
  }
  return newObj
}

/**
 * 将object中的属性名称从驼峰转换为下划线格式
 *
 * @param {any} obj 要转换的object
 * @returns 转换后的object
 */

function toUnderLine(obj) {
  const newObj = {}
  if (!(obj instanceof Object)) {
    return obj
  }
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const  newKey  = key.replace(/([A-Z])/g, (match, val, offset) => { return (offset ? '_' : '') + val }).toLowerCase()
      newObj[newKey] = obj[key]
    }
  }
  return newObj
}
