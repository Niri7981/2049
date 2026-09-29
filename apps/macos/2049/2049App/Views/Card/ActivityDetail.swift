import SwiftUI

struct ActivityDetail: View {
    let purchases: [AppOverview.Purchase]
    let agentName: String
    let isRefreshing: Bool
    let refreshError: String?
    let onBack: () -> Void
    let onRefresh: () async -> Void
    let onSelect: (String) -> Void

    private struct DayGroup: Identifiable {
        let day: Date
        let purchases: [AppOverview.Purchase]

        var id: Date { day }

        var title: String {
            if Calendar.current.isDateInToday(day) { return "Today" }
            if Calendar.current.isDateInYesterday(day) { return "Yesterday" }
            return day.formatted(.dateTime.month(.abbreviated).day().year())
        }
    }

    private var groups: [DayGroup] {
        let calendar = Calendar.current
        let byDay = Dictionary(grouping: purchases) { purchase in
            calendar.startOfDay(for: Date(timeIntervalSince1970: TimeInterval(purchase.createdAt) / 1_000))
        }
        return byDay.keys.sorted(by: >).map { day in
            DayGroup(day: day, purchases: byDay[day, default: []].sorted { $0.createdAt > $1.createdAt })
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button("Authority", systemImage: "chevron.left", action: onBack)
                    .buttonStyle(.plain)
                Spacer()
                Button("Refresh", systemImage: "arrow.clockwise") { Task { await onRefresh() } }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.plain)
                    .disabled(isRefreshing)
            }
            .padding(.bottom, 22)

            Text("Activity")
                .font(.title2.weight(.semibold))
                .padding(.bottom, 16)

            if isRefreshing {
                ProgressView("Refreshing activity")
                    .controlSize(.small)
                    .padding(.bottom, 10)
            }
            if let refreshError {
                Text(refreshError)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .padding(.bottom, 10)
            }

            if purchases.isEmpty {
                ContentUnavailableView("No activity yet", systemImage: "clock", description: Text("Requests made by this Agent will appear here."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(groups) { group in
                            Text(group.title)
                                .font(.caption.weight(.medium))
                                .foregroundStyle(.secondary)
                                .padding(.top, 16)
                                .padding(.bottom, 5)

                            ForEach(group.purchases, id: \.purchaseId) { purchase in
                                activityRow(purchase)
                                Divider()
                                    .padding(.leading, 42)
                            }
                        }
                    }
                    .padding(.bottom, 12)
                }
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .padding(.bottom, 12)
    }

    private func activityRow(_ purchase: AppOverview.Purchase) -> some View {
        let item = ActivityPurchasePresentation(purchase)
        return Button {
            onSelect(purchase.purchaseId)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: item.symbol)
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(width: 32, height: 32)
                    .background(Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 9))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.subheadline.weight(.medium))
                        .lineLimit(1)
                    Text(item.status)
                        .font(.subheadline)
                        .lineLimit(1)
                    Text("\(agentName) · \(item.time)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                Spacer(minLength: 4)

                Text(item.amount)
                    .font(.subheadline)
                    .monospacedDigit()
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(item.title), \(item.status), requested amount \(item.amount), \(agentName), \(item.timestamp)")
    }
}
