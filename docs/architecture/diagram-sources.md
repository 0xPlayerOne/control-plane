# Control Plane Diagram Sources

Status: Canonical repository source
Owner: Control Plane architecture
Last reviewed: 2026-08-23

These Mermaid definitions are the version-controlled source for the rendered diagrams in the canonical Google Docs.

## Editing and rendering rules

1. Edit the Mermaid definition here first.
2. Render and inspect the diagram before replacing the image in its owning document.
3. Keep the heading aligned with the owning Google Doc and figure purpose.
4. Do not hand-edit rendered diagram images.
5. Cross-repository definitions owned by Agent HQ remain in that repository's companion diagram-source file.

## Control Plane TDD: Execution & Orchestration

```mermaid
flowchart TB
    RQ[Execution Request] --> AUTH[Validate Authorization]
    AUTH --> RES[Resolve AgentProfile / Skills / Context]
    RES --> EP[Compile immutable ExecutionPlan]
    EP --> TW[Temporal Workflow]
    TW --> C{Graph semantics required?}
    C -->|No| RA[Runtime Adapter]
    C -->|Yes| LG[LangGraph.js Segment]
    LG --> RA
    RA --> RT{Runtime}
    RT -->|Managed| PI[Managed Pi]
    RT -->|External| ACP[ACP Adapter]
    ACP --> EXT[External Harness]
    PI --> OUT[Normalized Result / Events]
    EXT --> OUT
    OUT --> REC[Reconciliation]
    REC --> PS[(ProjectState)]
```

## Control Plane TDD: Context & Delegation Lifecycle

```mermaid
flowchart LR
    PS[(ProjectState)] --> SEL[Relevance Selection]
    SEL --> CP[ContextPackage]
    CP --> P[Parent Execution]
    P --> D{Delegate?}
    D -->|No| R[Result]
    D -->|Yes| W1[Worker A]
    D -->|Yes| W2[Worker B]
    W1 --> FAN[Reconciliation]
    W2 --> FAN
    P --> FAN
    FAN --> A{Promote durable output?}
    A -->|Yes| PS
    A -->|No| R
    FAN --> R
```

## Control Plane TDD: Runtime Adapter Architecture

```mermaid
classDiagram
    class RuntimeAdapter {
      +describe()
      +capabilities()
      +validate(request)
      +startExecution(request)
      +cancelExecution(id)
      +resumeExecution(ref)
      +streamEvents(id)
      +collectArtifacts(id)
    }
    class ManagedPiAdapter
    class ACPAdapter
    class RuntimeGateway
    class RuntimeDriver {
      +describeOperations()
      +execute(command)
      +cancel(commandId)
      +reconcile(commandId)
    }
    class ManagedPiDriver
    class ACPDriver
    class ManagedPi
    class ExternalHarness
    RuntimeAdapter <|-- ManagedPiAdapter
    RuntimeAdapter <|-- ACPAdapter
    ManagedPiAdapter --> RuntimeGateway : versioned commands
    ACPAdapter --> RuntimeGateway : versioned commands
    RuntimeGateway --> RuntimeDriver
    RuntimeDriver <|-- ManagedPiDriver
    RuntimeDriver <|-- ACPDriver
    ManagedPiDriver --> ManagedPi
    ACPDriver --> ExternalHarness
```

## ProjectState Concurrency and Promotion

```mermaid
sequenceDiagram
    participant E1 as Execution A
    participant E2 as Execution B
    participant P as Promotion Service
    participant S as ProjectState Store
    participant R as Reviewer or Policy
    E1->>P: StatePromotionProposal at revision 12
    E2->>P: StatePromotionProposal at revision 12
    P->>S: Compare-and-swap expected_revision 12
    S-->>P: Commit revision 13
    P->>S: Compare-and-swap expected_revision 12
    S-->>P: Conflict with current revision 13
    P->>R: Classify compatible, superseding, or review-required
    R->>S: Rebase, merge, approve, or reject
    S-->>P: New immutable revision when approved
    Note over E1,S: ContextPackages pin the exact ProjectState revision and item versions used
```
