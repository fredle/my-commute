import Foundation

/// Elizabeth line between Hayes & Harlington and Liverpool Street, from the
/// TfL Unified API (no key needed at this volume).
enum TfL {
    enum Station: String {
        case hayes = "910GHAYESAH"
        case lst = "910GLIVST"
    }

    struct Departure: Equatable {
        let at: Date
        let destination: String
    }

    struct LineStatus: Equatable {
        let good: Bool
        let text: String
        let reason: String
    }

    struct Snapshot: Equatable {
        let status: LineStatus
        let next: [Departure]
    }

    private struct ArrivalDTO: Decodable {
        let lineId: String
        let destinationName: String
        let expectedArrival: String
    }

    private struct LineDTO: Decodable {
        struct StatusDTO: Decodable {
            let statusSeverityDescription: String
            let reason: String?
        }
        let lineStatuses: [StatusDTO]
    }

    // Destinations that mean the train actually reaches the other end. Westbound trains
    // terminating at Paddington never get to Hayes; eastbound ones run through the
    // central section to Abbey Wood or Shenfield.
    private static let reachesLst = "abbey wood|shenfield|liverpool street|whitechapel|stratford|gidea park|romford|ilford|canary wharf"
    private static let reachesHayes = "heathrow|reading|maidenhead|hayes|west drayton|slough|twyford|langley|iver|burnham|taplow"

    private static func fetch<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        var request = URLRequest(url: URL(string: "https://api.tfl.gov.uk" + path)!)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func parseDate(_ s: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = fractional.date(from: s) { return d }
        return ISO8601DateFormatter().date(from: s)
    }

    /// Next Elizabeth line departures from `from` that reach `to`, soonest first.
    static func snapshot(from: Station, to: Station, now: Date) async throws -> Snapshot {
        async let arrivals = fetch("/StopPoint/\(from.rawValue)/Arrivals", as: [ArrivalDTO].self)
        async let lines = fetch("/Line/elizabeth/Status", as: [LineDTO].self)
        let (arr, status) = try await (arrivals, lines)

        let reaches = to == .lst ? reachesLst : reachesHayes
        let next = arr
            .filter { $0.lineId == "elizabeth" && $0.destinationName.range(of: reaches, options: [.regularExpression, .caseInsensitive]) != nil }
            .compactMap { a -> Departure? in
                guard let at = parseDate(a.expectedArrival) else { return nil }
                return Departure(at: at, destination: a.destinationName.replacingOccurrences(of: " Rail Station", with: ""))
            }
            .filter { $0.at >= now.addingTimeInterval(-30) }
            .sorted { $0.at < $1.at }
        return Snapshot(status: summarise(lines: status), next: Array(next.prefix(3)))
    }

    private static func summarise(lines: [LineDTO]) -> LineStatus {
        let bad = (lines.first?.lineStatuses ?? []).filter { $0.statusSeverityDescription != "Good Service" }
        guard let first = bad.first else { return LineStatus(good: true, text: "Good service", reason: "") }
        return LineStatus(
            good: false,
            text: bad.map(\.statusSeverityDescription).joined(separator: ", "),
            reason: shortReason(first.reason ?? "")
        )
    }

    /// Just the cause from a TfL reason, short enough for the Lock Screen:
    /// "ELIZABETH LINE: Severe delays between … while we fix a track fault at Hayes and Harlington. …"
    /// becomes "track fault at Hayes & Harlington".
    static func shortReason(_ reason: String) -> String {
        var r = reason.replacingOccurrences(of: "^[A-Z ]+:\\s*", with: "", options: .regularExpression)
        r = (r.components(separatedBy: ". ").first ?? r).trimmingCharacters(in: .whitespaces)

        let causePattern = "\\b(?:due to|while we (?:fix|repair|deal with|investigate)|because of|following)\\s+(.+)$"
        if let regex = try? NSRegularExpression(pattern: causePattern, options: .caseInsensitive),
           let m = regex.firstMatch(in: r, range: NSRange(r.startIndex..., in: r)),
           let range = Range(m.range(at: 1), in: r) {
            r = String(r[range])
        }
        r = r.replacingOccurrences(of: "^(?:an?|the)\\s+", with: "", options: [.regularExpression, .caseInsensitive])
        r = r.replacingOccurrences(of: "and Harlington", with: "& Harlington")
        if r.hasSuffix(".") { r.removeLast() }

        let maxLength = 60
        if r.count > maxLength {
            var cut = String(r.prefix(maxLength - 1))
            if let space = cut.lastIndex(of: " ") { cut = String(cut[..<space]) }
            r = cut + "…"
        }
        return r
    }
}
