import Foundation

class UploadService {
    static func upload(fileURL: URL, to baseURL: String, deviceId: String, completion: @escaping (Bool, String) -> Void) {
        guard !baseURL.isEmpty,
              let uploadURL = URL(string: "http://\(baseURL)/file/upload") else {
            completion(false, "无效的服务端地址")
            return
        }

        var request = URLRequest(url: uploadURL)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"deviceId\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(deviceId)\r\n".data(using: .utf8)!)

        guard let fileData = try? Data(contentsOf: fileURL) else {
            completion(false, "无法读取文件")
            return
        }
        let filename = fileURL.lastPathComponent
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: application/octet-stream\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        let task = URLSession.shared.uploadTask(with: request, from: body) { data, response, error in
            if let error = error {
                completion(false, error.localizedDescription)
            } else if let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      json["success"] as? Bool == true {
                let path = json["path"] as? String ?? filename
                completion(true, path)
            } else {
                completion(false, "上传失败")
            }
        }
        task.resume()
    }
}
