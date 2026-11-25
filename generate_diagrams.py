"""
Generate architecture diagram images from Mermaid code.
This script creates PNG images of all system architecture diagrams.
"""

import base64
import urllib.parse
import requests
from pathlib import Path
import time

# Create diagrams directory
diagrams_dir = Path("docs/diagrams")
diagrams_dir.mkdir(parents=True, exist_ok=True)

def generate_diagram_via_kroki(mermaid_code: str, output_path: str, format: str = "png"):
    """Generate diagram using Kroki API (free, no limits)"""
    try:
        # Encode the diagram
        encoded = base64.urlsafe_b64encode(mermaid_code.encode('utf-8')).decode('utf-8')
        
        # Kroki API URL
        url = f"https://kroki.io/mermaid/{format}/{encoded}"
        
        # Download the image
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        # Save to file
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"✓ Generated: {output_path}")
        return True
    except Exception as e:
        print(f"✗ Failed to generate {output_path}: {e}")
        return False

# Define all diagrams
diagrams = {
    "01_high_level_architecture": '''
flowchart TB
    subgraph Client["Client Layer"]
        FE[React Frontend<br/>Material-UI]
    end
    
    subgraph API["API Layer (Express)"]
        ROUTES[Routes & Controllers]
        MW[Middleware<br/>Auth, Validation, Rate Limit]
    end
    
    subgraph Application["Application Layer"]
        AUTH[Auth Service]
        COURSE[Course Service]
        DOC[Document Service]
        CHAT[Chat Service]
        LEARN[Learning Service]
        INS[Insights Service]
        ADMIN[Admin Service]
    end
    
    subgraph Domain["Domain Layer"]
        ENTITIES[Entities & Value Objects]
        POLICIES[Authorization Policies]
        RULES[Business Rules]
    end
    
    subgraph AI["AI Layer (LangGraph.js)"]
        CGRAPH[Chat Graph]
        LGRAPH[Learning Content Graph]
        IGRAPH[Insights Graph]
        NODES[Nodes: Query Understanding,<br/>Retrieval, Context Builder,<br/>Answer Gen, Citation Validator]
    end
    
    subgraph Infrastructure["Infrastructure Layer"]
        REPOS[Repositories<br/>Interfaces]
        JSON[JSON Store Engine]
        SQLITE[SQLite Database]
        STORAGE[File Storage]
        PROVIDERS[AI Providers<br/>Inception, Groq, Mistral]
    end
    
    subgraph Background["Background Processing"]
        JOBS[Job Runner]
        SCHED[Job Scheduler]
        QUEUE[Job Queue<br/>JSON Store]
    end
    
    subgraph Data["Data Storage"]
        JSONFILES[(JSON Files<br/>users, courses,<br/>documents, etc.)]
        CONVDB[(SQLite<br/>conversations<br/>messages)]
        FILES[(File System<br/>uploads, chunks)]
    end
    
    FE -->|HTTP/REST| ROUTES
    ROUTES --> MW
    MW --> AUTH
    MW --> COURSE
    MW --> DOC
    MW --> CHAT
    MW --> LEARN
    MW --> INS
    MW --> ADMIN
    
    CHAT --> CGRAPH
    LEARN --> LGRAPH
    INS --> IGRAPH
    
    CGRAPH --> NODES
    LGRAPH --> NODES
    IGRAPH --> NODES
    
    AUTH --> REPOS
    COURSE --> REPOS
    DOC --> REPOS
    CHAT --> REPOS
    LEARN --> REPOS
    INS --> REPOS
    ADMIN --> REPOS
    
    NODES --> PROVIDERS
    NODES --> REPOS
    
    REPOS --> JSON
    REPOS --> SQLITE
    REPOS --> STORAGE
    
    JSON --> JSONFILES
    SQLITE --> CONVDB
    STORAGE --> FILES
    
    DOC --> JOBS
    INS --> JOBS
    ADMIN --> JOBS
    
    JOBS --> QUEUE
    SCHED --> QUEUE
    QUEUE --> JSON
''',

    "02_layer_architecture": '''
flowchart LR
    subgraph HTTP["HTTP Layer"]
        R[Routes]
        C[Controllers]
    end
    
    subgraph APP["Application Layer"]
        S[Services]
        P[Policies]
    end
    
    subgraph DOMAIN["Domain Layer"]
        E[Entities]
        VO[Value Objects]
        BR[Business Rules]
    end
    
    subgraph AI["AI Layer"]
        G[Graphs]
        N[Nodes]
        PR[Prompts]
    end
    
    subgraph INFRA["Infrastructure Layer"]
        REPO[Repositories]
        ADAPT[Adapters]
        STORE[Stores]
    end
    
    R --> C
    C -->|Parse, Validate| S
    S --> P
    S --> E
    S --> G
    S --> REPO
    G --> N
    N --> ADAPT
    REPO --> STORE
''',

    "03_authentication_flow": '''
sequenceDiagram
    participant U as User
    participant C as Controller
    participant AS as AuthService
    participant AR as AuthRepository
    participant JSON as JSON Store
    
    U->>C: POST /auth/login
    C->>AS: login(email, password)
    
    AS->>AR: findByEmail(email)
    AR->>JSON: Read users.json
    JSON-->>AR: User record
    AR-->>AS: User | null
    
    alt User not found
        AS-->>C: Error
        C-->>U: 401 Unauthorized
    end
    
    AS->>AS: Verify password
    
    alt Password incorrect
        AS->>AR: incrementFailedLogins
        AS-->>C: Error
        C-->>U: 401 Unauthorized
    end
    
    AS->>AS: Generate tokens
    AS->>AR: storeRefreshToken
    AR->>JSON: Write refresh_tokens.json
    
    AS-->>C: tokens + user
    C-->>U: 200 OK + Cookie
''',

    "04_document_ingestion": '''
sequenceDiagram
    participant U as User
    participant API as API
    participant DS as DocumentService
    participant FS as FileStorage
    participant JS as JobService
    participant JR as JobRunner
    participant IS as IngestionService
    participant EP as EmbeddingProvider
    
    U->>API: POST /documents/upload
    API->>DS: upload(file)
    DS->>DS: Validate
    DS->>FS: store(file)
    DS->>JS: enqueueJob(ingest)
    DS-->>API: 202 Accepted
    
    JR->>IS: ingest(job)
    IS->>FS: Read file
    IS->>IS: Extract text
    IS->>IS: Chunk text
    IS->>EP: embed(chunks)
    EP-->>IS: embeddings
    IS->>FS: Write chunks file
    IS-->>JR: Success
''',

    "05_chat_flow": '''
sequenceDiagram
    participant U as Learner
    participant API as API
    participant CS as ChatService
    participant GR as GraphRunner
    participant G as Chat Graph
    participant RS as RetrievalService
    participant LLM as LLM Provider
    participant DB as Database
    
    U->>API: POST /chat/ask
    API->>CS: ask(question)
    CS->>CS: Check permissions
    CS->>DB: Get conversation history
    CS->>GR: run(state)
    
    GR->>G: Invoke graph
    G->>G: queryUnderstanding
    G->>G: rewriteQuery
    G->>RS: retrieval.search
    RS-->>G: chunks with scores
    G->>G: contextBuilder
    G->>G: evidenceGate
    
    alt Insufficient evidence
        G-->>GR: insufficient
    else Evidence OK
        G->>LLM: answerGeneration
        LLM-->>G: answer + citations
        G->>G: citationValidator
        G-->>GR: grounded
    end
    
    GR-->>CS: Final state
    CS->>DB: Save messages
    CS-->>API: Answer + citations
    API-->>U: 200 OK
''',

    "06_chat_graph_execution": '''
graph TB
    START([START]) --> QU[Query Understanding]
    
    QU --> ROUTE{Intent?}
    ROUTE -->|question| RQ[Rewrite Query]
    ROUTE -->|other| END1([END<br/>suggestedAction])
    
    RQ --> RET[Retrieval]
    RET --> RR[Rerank]
    RR --> CB[Context Builder]
    CB --> EG[Evidence Gate]
    
    EG --> CHECK{Min similarity?}
    CHECK -->|No| END2([END<br/>insufficient])
    CHECK -->|Yes| AG[Answer Generation]
    
    AG --> CV[Citation Validator]
    
    CV --> VAL{Valid?}
    VAL -->|No| END3([END<br/>unverified])
    VAL -->|Yes| END4([END<br/>grounded])
''',

    "07_quiz_generation": '''
sequenceDiagram
    participant U as Learner
    participant API as API
    participant LS as LearningService
    participant RS as RetrievalService
    participant LG as Learning Graph
    participant LLM as LLM Provider
    participant JSON as JSON Store
    
    U->>API: POST /quizzes/generate
    API->>LS: generateQuiz(params)
    LS->>LS: Validate access
    LS->>RS: selectContent
    RS-->>LS: contextChunks
    
    LS->>LG: run(generateQuiz)
    LG->>LLM: Generate quiz
    LLM-->>LG: questions + sources
    LG->>LG: Validate citations
    LG-->>LS: Quiz structure
    
    LS->>JSON: Store quiz
    LS-->>API: Quiz (learner view)
    API-->>U: 200 OK (no key)
''',

    "08_quiz_attempt": '''
sequenceDiagram
    participant U as Learner
    participant API as API
    participant LS as LearningService
    participant JSON as JSON Store
    
    U->>API: GET /quizzes/:id
    API->>LS: getQuiz(quizId)
    LS->>JSON: Read quiz
    LS->>LS: Transform to learner view
    LS-->>API: Quiz (no key)
    API-->>U: Questions only
    
    U->>API: POST /quizzes/:id/attempts
    API->>LS: submitAttempt(answers)
    LS->>JSON: Read quiz with key
    LS->>LS: Score server-side
    LS->>JSON: Store attempt
    LS-->>API: Score + explanations
    API-->>U: 200 OK with results
''',

    "09_insights_generation": '''
sequenceDiagram
    participant SCHED as Scheduler
    participant JR as JobRunner
    participant IS as InsightsService
    participant JSON as JSON Store
    participant DB as SQLite
    participant LLM as LLM Provider
    
    SCHED->>JR: Trigger gap report
    JR->>IS: generateGapReport
    IS->>JSON: Read activity_events
    IS->>DB: Read question text
    IS->>IS: Embed questions
    IS->>IS: Cluster embeddings
    
    loop For each cluster
        IS->>LLM: Label theme
        LLM-->>IS: theme + action
    end
    
    IS->>IS: Apply cohort filter
    IS->>JSON: Write gap_report
    IS-->>JR: Success
''',

    "10_communication_patterns": '''
graph TB
    subgraph "Synchronous"
        C1[Controller] -->|Service Interface| S1[Service]
        S1 -->|Repository Interface| R1[Repository]
        S1 -->|Graph Interface| G1[Graph]
    end
    
    subgraph "Asynchronous"
        S2[Service] -->|Enqueue| JQ[Job Queue]
        JR[Job Runner] -->|Claim| JQ
        JR -->|Execute| H[Handler]
    end
    
    subgraph "Event-Based"
        N[Node] -->|Record| ER[Execution Tracker]
        ER -->|Write| DB[(Database)]
    end
''',

    "11_data_flow_read": '''
flowchart LR
    Q[Question] --> AC[Access Control]
    AC --> CH[Get History]
    CH --> RW[Rewrite Query]
    RW --> EMB[Embed]
    EMB --> FILT[Access Filter]
    FILT --> VS[Vector Search]
    VS --> CTX[Build Context]
    CTX --> GEN[Generate Answer]
    GEN --> VAL[Validate]
    VAL --> SAVE[Save]
    SAVE --> RESP[Response]
''',

    "12_data_flow_write": '''
flowchart TD
    F[File Upload] --> V[Validate]
    V --> STOR[Store File]
    STOR --> META[Create Record]
    META --> ENQ[Enqueue Job]
    ENQ --> CLM[Claim Job]
    CLM --> EXT[Extract Text]
    EXT --> CHK[Chunk]
    CHK --> EMBD[Embed]
    EMBD --> WC[Write Chunks]
    WC --> UD[Update Status]
''',

    "13_deployment": '''
graph TB
    subgraph "Docker Container"
        subgraph "Process"
            API[Express API]
            JOBS[Job Runner]
            SCHED[Scheduler]
        end
        
        subgraph "Volume"
            JSON[(JSON Files)]
            SQLITE[(SQLite)]
            FILES[(Files)]
        end
    end
    
    subgraph "External"
        INC[Inception API]
        GROQ[Groq API]
        MIST[Mistral API]
    end
    
    CLIENT[Browser] --> API
    API --> JSON
    API --> SQLITE
    API --> INC
    API --> GROQ
    API --> MIST
''',

    "14_security_auth": '''
sequenceDiagram
    participant U as User
    participant MW as Middleware
    participant TS as TokenService
    participant PS as PermissionService
    participant H as Handler
    
    U->>MW: Request + Bearer token
    MW->>TS: Verify JWT
    TS-->>MW: userId, role
    MW->>PS: Resolve permissions
    PS-->>MW: Permission set
    MW->>MW: Check permission
    
    alt Missing permission
        MW-->>U: 403 Forbidden
    end
    
    MW->>H: Attach user
    H->>H: Ownership check
    
    alt Not owner
        H-->>U: 403 Forbidden
    end
    
    H-->>U: 200 OK
''',

    "15_citation_validation": '''
flowchart TD
    START([Answer + Citations]) --> V1{V1: ChunkIds<br/>exist?}
    V1 -->|No| FAIL1([UNVERIFIED])
    V1 -->|Yes| V2{V2: Markers<br/>match?}
    V2 -->|No| FAIL2([UNVERIFIED])
    V2 -->|Yes| V3{V3: All markers<br/>cited?}
    V3 -->|No| FAIL3([UNVERIFIED])
    V3 -->|Yes| V4{V4: Min citations?}
    V4 -->|No| FAIL4([UNVERIFIED])
    V4 -->|Yes| PASS([GROUNDED])
'''
}

def main():
    print("Generating architecture diagram images...\n")
    
    success_count = 0
    total_count = len(diagrams)
    
    for name, mermaid_code in diagrams.items():
        output_path = diagrams_dir / f"{name}.png"
        if generate_diagram_via_kroki(mermaid_code.strip(), str(output_path)):
            success_count += 1
        time.sleep(0.5)  # Be nice to the API
    
    print(f"\n{'='*60}")
    print(f"Generated {success_count}/{total_count} diagrams successfully")
    print(f"Output directory: {diagrams_dir.absolute()}")
    print(f"{'='*60}")
    
    if success_count < total_count:
        print("\nNote: Some diagrams failed. You can:")
        print("1. Check your internet connection")
        print("2. Try running the script again")
        print("3. Use the Mermaid code from SYSTEM-ARCHITECTURE.md")
        print("   with online tools like https://mermaid.live/")

if __name__ == "__main__":
    main()
