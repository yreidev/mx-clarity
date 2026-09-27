/** 从官方主题迁过来的订阅地址是 `/feed`：永久跳到 `/atom.xml` */
export default defineEventHandler(event => sendRedirect(event, '/atom.xml', 308))
