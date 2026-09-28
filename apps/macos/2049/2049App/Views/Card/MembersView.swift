import SwiftUI

struct MembersView: View {
    let session: CardMemberSession

    @State private var showingDetail = false
    @State private var editor: Editor?
    @State private var nameInput = ""
    @State private var isSaving = false
    @State private var message: String?
    @State private var showingRevokeConfirmation = false
    @State private var revokeTargetID: UUID?

    private enum Editor: Equatable { case create, rename(UUID) }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let editor {
                editorContent(editor)
            } else if showingDetail, let member = session.selectedMember {
                detailContent(member)
            } else {
                listContent
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 24)
        .padding(.bottom, 12)
        .confirmationDialog("Revoke this agent?", isPresented: $showingRevokeConfirmation) {
            Button("Revoke agent", role: .destructive) {
                if let id = revokeTargetID { Task { await revoke(id) } }
            }
        } message: {
            Text("Its connection and grant will be revoked. Existing purchase records remain available in the backend.")
        }
        .onChange(of: session.selectedMemberID) { _, _ in
            // A focused rename is always about the card's current member.
            if case .some(.rename) = editor { editor = nil }
            showingRevokeConfirmation = false
            revokeTargetID = nil
            message = nil
        }
        .task { await session.refresh() }
    }

    private var listContent: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Members").font(.title2)
                Spacer()
                Button("Add agent", systemImage: "plus") {
                    nameInput = ""
                    message = nil
                    editor = .create
                }
                .labelStyle(.iconOnly)
                .disabled(isSaving)
            }
            Text("Agents share one daily budget.")
                .font(.subheadline)
                .foregroundStyle(.secondary)

            if session.isLoading && session.members.isEmpty {
                ProgressView("Loading agents").controlSize(.small)
            } else if session.members.isEmpty {
                ContentUnavailableView(session.loadError == nil ? "No agents" : "Agents unavailable", systemImage: "person.2",
                    description: Text(session.loadError == nil ? "Add an agent to use this card." : "Retry loading the agent list."))
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(session.members, id: \.member.id) { entry in
                            if entry.member.status == .active {
                                Button {
                                    session.select(entry.member.id)
                                    showingDetail = true
                                    message = nil
                                } label: {
                                    memberRow(entry)
                                }
                                .buttonStyle(.plain)
                            } else {
                                memberRow(entry)
                                    .opacity(0.55)
                            }
                            Divider()
                        }
                    }
                }
            }

            if let error = session.loadError {
                HStack {
                    Text(error).foregroundStyle(.red)
                    Button("Retry") { Task { await session.refresh(retry: true) } }
                        .buttonStyle(.link)
                }
                .font(.subheadline)
            } else if let message {
                Text(message).font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }

    private func memberRow(_ entry: CardMemberSummary) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(entry.member.label)
                    .font(.body.weight(entry.member.id == session.selectedMemberID ? .semibold : .regular))
                    .lineLimit(1)
                Text(entry.member.status == .revoked
                     ? "Revoked"
                     : "\(entry.connection.enabled ? "Connected" : "Not connected") · \(entry.grant?.status == .active ? "Grant active" : "No active grant")")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if entry.member.id == session.selectedMemberID {
                Image(systemName: "checkmark")
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Current agent")
            }
            if entry.member.status == .active {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
        }
        .frame(minHeight: 60)
        .contentShape(Rectangle())
    }

    private func detailContent(_ member: CardMemberSnapshot.Member) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Button("Members", systemImage: "chevron.left") { showingDetail = false }
                .buttonStyle(.plain)
            Text(member.label)
                .font(.title2)
                .lineLimit(2)
            Text(member.isDefault ? "Default agent · Active" : "Active agent")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            Divider()
            if let entry = session.members.first(where: { $0.member.id == member.id }) {
                fact("Connection", entry.connection.enabled ? "Enabled" : "Not connected")
                fact("Spend Grant", grantStatus(entry.grant))
            }
            Divider()
            Button("Rename agent") {
                nameInput = member.label
                message = nil
                editor = .rename(member.id)
            }
            .disabled(isSaving)
            if !member.isDefault {
                Button("Revoke agent", role: .destructive) {
                    revokeTargetID = member.id
                    showingRevokeConfirmation = true
                }
                    .disabled(isSaving)
            }
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
        }
    }

    private func editorContent(_ editor: Editor) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Button("Members", systemImage: "chevron.left") { self.editor = nil }
                .buttonStyle(.plain)
                .disabled(isSaving)
            Text(editor == .create ? "Add agent" : "Rename agent")
                .font(.title2)
            TextField("Agent name", text: $nameInput)
                .textFieldStyle(.roundedBorder)
                .onSubmit { Task { await save(editor) } }
                .disabled(isSaving)
            Button(editor == .create ? "Add agent" : "Save name") { Task { await save(editor) } }
                .disabled(isSaving)
            if isSaving { ProgressView("Saving agent").controlSize(.small) }
            if let message {
                Text(message).font(.subheadline).foregroundStyle(.red)
            }
            Spacer(minLength: 0)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
        .font(.subheadline)
    }

    private func grantStatus(_ grant: AppOverview.Grant?) -> String {
        switch grant?.status {
        case .active: "Active"
        case .revoked: "Revoked"
        case .expired: "Expired"
        case nil: "Not set"
        }
    }

    @MainActor
    private func save(_ editor: Editor) async {
        guard !isSaving else { return }
        let name = nameInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 120 else {
            message = "Enter an agent name of 1–120 characters."
            return
        }
        isSaving = true
        defer { isSaving = false }
        do {
            switch editor {
            case .create:
                try await session.create(label: name)
                showingDetail = false // Creating an agent keeps the current selection.
            case .rename(let id):
                guard session.selectedMemberID == id else { return }
                try await session.rename(id, label: name)
            }
            self.editor = nil
            message = nil
        } catch {
            message = (error as? OverviewLoadError)?.message ?? "Agent could not be saved"
        }
    }

    @MainActor
    private func revoke(_ id: UUID) async {
        guard session.selectedMemberID == id, !isSaving else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            try await session.revoke(id)
            showingDetail = false
            message = "Agent revoked"
        } catch {
            message = (error as? OverviewLoadError)?.message ?? "Agent could not be revoked"
        }
    }
}
