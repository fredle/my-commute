import CoreLocation
import MapKit

/// Drive time with current traffic, from Apple Maps (replaces the Waze sensors).
enum DriveTime {
    static func minutes(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async throws -> Int {
        let request = MKDirections.Request()
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: from))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to))
        request.transportType = .automobile
        request.departureDate = Date()
        let eta = try await MKDirections(request: request).calculateETA()
        return Int((eta.expectedTravelTime / 60).rounded())
    }
}
