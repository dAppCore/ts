
//import {S3Client} from "s3Client"
 import { Injectable } from "@danet/core";
import { S3Client } from "@bradenmacdonald/s3-lite-client";

@Injectable()
export class ModIoFsS3Service {
    client: S3Client;

    options: {
        connect:
            {
                endPoint: string,
                port?: number,
                useSSL: boolean,
                region: string,
                bucket?: string,
                pathStyle?: boolean,
                accessKey?: string,
                secretKey?: string,
                sessionToken?: string
            }
    } = {
        connect: {
            endPoint: "s3.us-east-1.amazonaws.com",
            port: 443,
            useSSL: true,
            region: "us-east-1",
            bucket: "openalex",
            pathStyle: false,
        }
    }

    constructor() {

    }

    connect() {
        this.client = new S3Client(this.options.connect)
    }

    async list(options) {
        const ret = []
        for await (const object of this.client.listObjects(options)) {
            ret.push(object)
        }
        return ret
    }

    async exists(key: string){
        return await this.client.exists(key)
    }

    async bucketExists(key: string) {
        return await this.client.bucketExists(key)
    }

    async bucketMake(key: string) {
        return await this.client.makeBucket(key)
    }
    async bucketRemove(key: string) {
        return await this.client.removeBucket(key)
    }

    async objectMeta(key: string) {
        return await this.client.statObject(key)
    }

    async objectGet(key: string){
        return await this.client.getObject(key)
    }

    async objectGetPartial(key: string, start: number, length: number){
        return await this.client.getPartialObject(key, {offset: start, length: length})
    }

    async objectGetPresigned(key: string, options: {
        bucketName?: string;
        versionId?: string;
        expirySeconds?: number;
        requestDate?: Date;
    }) {
        return await this.client.presignedGetObject(key, options)
    }

    async objectGetPresignedURL(key: string, options: { bucketName?: string; parameters?: Record<string, string>; expirySeconds?: number; requestDate?: Date }) {
        return await this.client.getPresignedUrl('GET', key, options)
    }

    async objectPut(key: string, data:string|Uint8Array|ReadableStream, options: {}) {
        return await this.client.putObject(key, data, options)
    }

    async objectCopy(source: { sourceBucketName?: string; sourceKey: string; sourceVersionId?: string }, dest: string, options: { bucketName?: string }) {
        return await this.client.copyObject(source, dest, options)
    }

    async objectDelete(key: string, options: { bucketName?: string; versionId?: string; governanceBypass?: boolean }) {
        return await this.client.deleteObject(key, options)
    }
}