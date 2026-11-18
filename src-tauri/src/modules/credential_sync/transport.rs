use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signer, SigningKey};
use reqwest::{Client, Method};
use serde_json::Value;
use sha2::{Digest,Sha256};
use std::time::Duration;

pub fn client(server: &str) -> Result<Client,String> {
    let url=url::Url::parse(server).map_err(|_|"同步服务器地址无效")?;
    if url.scheme()!="https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some(){return Err("同步服务器必须使用不含凭据、查询或片段的 HTTPS 地址".into());}
    let mut builder=Client::builder().timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none());
    if url.host_str()==Some("100.100.1.1") {
        builder=builder.add_root_certificate(reqwest::Certificate::from_pem(include_bytes!("../../../../docs/credential-sync/server-ca.pem")).map_err(|_|"同步服务器证书无效")?);
    }
    builder.build().map_err(|_|"无法建立同步网络客户端".into())
}
pub async fn request(server:&str,device:&str,key:&SigningKey,method:Method,path:&str,body:Option<Value>)->Result<Value,String>{
    let timestamp=chrono::Utc::now().timestamp().to_string();let nonce=uuid::Uuid::new_v4().to_string();
    let bytes=body.map(|v|serde_json::to_vec(&v)).transpose().map_err(|_|"同步请求编码失败")?.unwrap_or_default();
    let canonical=format!("{}\n{}\n{}\n{}\n{:x}",method,path,timestamp,nonce,Sha256::digest(&bytes));
    let response=client(server)?.request(method,format!("{}{}",server.trim_end_matches('/'),path))
      .header("x-device-id",device).header("x-timestamp",timestamp).header("x-nonce",nonce)
      .header("x-signature",STANDARD.encode(key.sign(canonical.as_bytes()).to_bytes())).header("content-type","application/json").body(bytes).send().await.map_err(|_|"同步服务网络请求失败")?;
    let status=response.status();if !status.is_success(){return Err(format!("同步服务返回 HTTP {}",status.as_u16()));}
    let mut response=response;let mut bytes=Vec::new();
    while let Some(chunk)=response.chunk().await.map_err(|_|"同步服务读取失败")?{if bytes.len()+chunk.len()>131072{return Err("同步响应超过大小限制".into());}bytes.extend(chunk);}
    serde_json::from_slice(&bytes).map_err(|_|"同步服务响应格式无效".into())
}
pub async fn enroll(server:&str,code:&str,device_id:&str,public_key:&str,box_public_key:&str)->Result<Value,String>{
    let body=serde_json::json!({"code":code,"device_id":device_id,"public_key":public_key,"box_public_key":box_public_key});
    let response=client(server)?.post(format!("{}/v1/enroll",server.trim_end_matches('/'))).json(&body).send().await.map_err(|e|format!("设备登记连接失败: {}",diagnostic(&e)))?;
    let status=response.status();if !status.is_success(){return Err(format!("设备登记返回 HTTP {}",status.as_u16()));}
    response.json().await.map_err(|_|"设备登记响应格式无效".into())
}

pub async fn poll_enrollment(server:&str,code:&str,device_id:&str)->Result<Value,String>{
 let response=client(server)?.post(format!("{}/v1/enroll/status",server.trim_end_matches('/'))).json(&serde_json::json!({"code":code,"device_id":device_id})).send().await.map_err(|_|"配对状态查询失败")?;
 if !response.status().is_success(){return Err(format!("配对状态 HTTP {}",response.status().as_u16()));}
 response.json().await.map_err(|_|"配对状态格式无效".into())
}
pub async fn recover_enrollment(server:&str,body:Value)->Result<Value,String>{
 let response=client(server)?.post(format!("{}/v1/enroll/recover",server.trim_end_matches('/'))).json(&body).send().await.map_err(|_|"恢复登记请求失败")?;
 if !response.status().is_success(){return Err(format!("恢复登记 HTTP {}",response.status().as_u16()));}
 if response.content_length().is_some_and(|n|n>131072){return Err("恢复响应超过大小限制".into());}
 response.json().await.map_err(|_|"恢复登记响应无效".into())
}
pub async fn pairing_request(server:&str,path:&str,body:Value)->Result<Value,String>{
 let mut response=client(server)?.post(format!("{server}{path}")).json(&body).send().await.map_err(|_|"配对服务连接失败")?;
 let status=response.status();
 if !status.is_success(){return Err(if status.as_u16()==401{"配对码无效或已更换".into()}else{format!("配对服务返回 HTTP {}",status.as_u16())});}
 let mut bytes=Vec::new();
 while let Some(chunk)=response.chunk().await.map_err(|_|"配对响应读取失败")?{
  if bytes.len()+chunk.len()>65536{return Err("配对响应超过大小限制".into());}
  bytes.extend(chunk);
 }
 serde_json::from_slice(&bytes).map_err(|_|"配对响应格式无效".into())
}

fn diagnostic(error:&reqwest::Error)->String{
 use std::error::Error;
 let mut parts=Vec::new();let mut source=error.source();
 while let Some(value)=source{parts.push(value.to_string());source=value.source();if parts.len()>=4{break;}}
 if parts.is_empty(){if error.is_timeout(){"请求超时".into()}else{"请求无法建立连接".into()}}else{parts.join("; ")}
}
