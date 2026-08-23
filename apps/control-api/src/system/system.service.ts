import { Injectable } from '@nestjs/common'

@Injectable()
export class SystemService {
  echo(message: string) {
    return { message }
  }
}
