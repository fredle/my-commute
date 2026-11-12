import Foundation
import Security

/// The app's server (server/ in this repo). Each install identifies itself with a random
/// secret kept in the Keychain; there are no accounts.
enum Backend {
    struct Failure: LocalizedError {
        let status: Int
        let message: String
        var errorDescription: String? { message }
    }

    struct Started: Decodable {
        let attributes: Attributes
        let state: CommuteAttributes.ContentState

        struct Attributes: Decodable {
            let commuteId: String
            let direction: CommuteDirection
            let fromName: String
            let toName: String
        }

        var activityAttributes: CommuteAttributes {
            CommuteAttributes(
                commuteId: attributes.commuteId,
                direction: attributes.direction,
                fromName: attributes.fromName,
                toName: attributes.toName
            )
        }
    }

    struct EventResult: Decodable {
        let stage: CommuteStage
        let ended: Bool
    }

    private struct Stations: Decodable { let stations: [Station] }
    private struct ErrorBody: Decodable { let error: String }
    private struct Empty: Decodable {}

    static var baseURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "BackendURL") as? String
        return URL(string: configured ?? "")!
    }

    // MARK: Calls

    static func putConfig(_ config: ServerConfig) async throws {
        let _: Empty = try await send("PUT", "/v1/me", body: config)
    }

    static func deleteMe() async throws {
        let _: Empty? = try await sendAllowingEmpty("DELETE", "/v1/me")
    }

    static func searchStations(_ query: String) async throws -> [Station] {
        var items = URLComponents()
        items.queryItems = [URLQueryItem(name: "q", value: query)]
        let result: Stations = try await send("GET", "/v1/stations?\(items.percentEncodedQuery ?? "")")
        return result.stations
    }

    static func stationsNear(latitude: Double, longitude: Double) async throws -> [Station] {
        let result: Stations = try await send("GET", String(format: "/v1/stations?near=%.4f,%.4f", latitude, longitude))
        return result.stations
    }

    static func status(_ direction: CommuteDirection) async throws -> CommuteAttributes.ContentState {
        try await send("GET", "/v1/status?direction=\(direction.rawValue)")
    }

    static func startCommute(_ direction: CommuteDirection) async throws -> Started {
        try await send("POST", "/v1/commutes", body: ["direction": direction.rawValue])
    }

    static func setActivityToken(commuteId: String, token: String) async throws {
        let _: Empty = try await send("PUT", "/v1/commutes/\(commuteId)/token", body: ["token": token])
    }

    static func reportRegion(commuteId: String, region: String, entered: Bool) async throws -> EventResult {
        try await send("POST", "/v1/commutes/\(commuteId)/events", body: ["region": region, "kind": entered ? "enter" : "exit"])
    }

    static func endCommute(commuteId: String) async throws {
        let _: Empty? = try await sendAllowingEmpty("DELETE", "/v1/commutes/\(commuteId)")
    }

    // MARK: Plumbing

    private static func send<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T {
        guard let value: T = try await sendAllowingEmpty(method, path, body: body) else {
            throw Failure(status: 0, message: "The server sent nothing back.")
        }
        return value
    }

    private static func sendAllowingEmpty<T: Decodable>(_ method: String, _ path: String, body: (any Encodable)? = nil) async throws -> T? {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 20
        request.setValue("Bearer \(identity())", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ErrorBody.self, from: data))?.error ?? "Server error (\(status))."
            throw Failure(status: status, message: message)
        }
        if status == 204 || data.isEmpty { return nil }
        return try JSONDecoder().decode(T.self, from: data)
    }

    // MARK: Identity

    private static let account = "install-secret"

    /// The install's secret, made on first use. Readable after first unlock so that
    /// geofence wake-ups with the phone locked can still reach the server.
    static func identity() -> String {
        if let existing = readSecret() { return existing }
        var bytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        let secret = Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
        let add: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            kSecValueData as String: Data(secret.utf8),
        ]
        SecItemAdd(add as CFDictionary, nil)
        return secret
    }

    static func forgetIdentity() {
        SecItemDelete([kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account] as CFDictionary)
    }

    private static func readSecret() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}
