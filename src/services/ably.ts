import Ably from 'ably'

const ablyApiKey = process.env.NEXT_PUBLIC_ABLY_API_KEY!

export const ably = new Ably.Realtime({ key: ablyApiKey })
