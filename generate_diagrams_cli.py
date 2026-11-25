"""
Generate architecture diagram images using local mermaid-cli (mmdc).
Requires: npm install -g @mermaid-js/mermaid-cli
"""

import subprocess
from pathlib import Path
import sys

# Create directories
diagrams_dir = Path("docs/diagrams")
mmd_dir = Path("docs/diagrams/mmd")
diagrams_dir.mkdir(parents=True, exist_ok=True)
mmd_dir.mkdir(parents=True, exist_ok=True)

# Simplified and working diagrams
diagrams = {
    "01_system_overview": '''
flowchart TB
    Client[Client Browser<br/>React + Material-UI]
    API[Express REST API<br/>/api/v1]
    Services[Application Services<br/>Auth, Course, Document, Chat]
    AI[LangGraph AI Orchestration<br/>Query Understanding, Retrieval,<br/>Answer Generation, Citation Validation]
    Storage[Data Storage<br/>JSON + SQLite + Files]
    Jobs[Background Processing<br/>Job Runner + Scheduler]
    
    Client -->|HTTPS| API
    API --> Services
    Services --> AI
    Services --> Storage
    Services --> Jobs
    
    style Client fill:#e3f2fd,stroke:#01579b,stroke-width:2px
    style API fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style Services fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    style AI fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    style Storage fill:#fce4ec,stroke:#880e4f,stroke-width:2px
    style Jobs fill:#fff9c4,stroke:#f57f17,stroke-width:2px
''',

    "02_layer_architecture": '''
flowchart LR
    HTTP[HTTP Layer<br/>Routes & Controllers]
    App[Application Layer<br/>Services & Policies]
    Domain[Domain Layer<br/>Entities & Rules]
    AI[AI Layer<br/>Graphs & Nodes]
    Infra[Infrastructure<br/>Repositories & Adapters]
    
    HTTP -->|Parse & Validate| App
    App -->|Business Logic| Domain
    App -->|Orchestration| AI
    App -->|Data Access| Infra
    AI -->|Providers| Infra
    
    style HTTP fill:#bbdefb,stroke:#0d47a1,stroke-width:2px
    style App fill:#c5cae9,stroke:#311b92,stroke-width:2px
    style Domain fill:#e1bee7,stroke:#4a148c,stroke-width:2px
    style AI fill:#c8e6c9,stroke:#1b5e20,stroke-width:2px
    style Infra fill:#f8bbd0,stroke:#880e4f,stroke-width:2px
''',

    "03_chat_graph_flow": '''
flowchart TD
    Start([User Question])
    QU[Query Understanding<br/>Classify Intent]
    RQ[Rewrite Query<br/>With History Context]
    Retrieve[Retrieval<br/>Vector Search + Access Filter]
    Context[Context Builder<br/>Number Chunks 1 to N]
    Gate{Evidence Gate<br/>Min Similarity?<br/>Min Chunks?}
    Generate[Answer Generation<br/>LLM with Structured Output]
    Validate[Citation Validator<br/>Deterministic V1-V5 Checks]
    Grounded([Grounded Answer<br/>with Valid Citations])
    Insufficient([Insufficient<br/>Material Unavailable])
    Unverified([Unverified<br/>Citations Invalid])
    
    Start --> QU
    QU --> RQ
    RQ --> Retrieve
    Retrieve --> Context
    Context --> Gate
    Gate -->|Pass| Generate
    Gate -->|Fail| Insufficient
    Generate --> Validate
    Validate -->|Valid| Grounded
    Validate -->|Invalid| Unverified
    
    style Start fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    style Grounded fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px
    style Insufficient fill:#ffccbc,stroke:#bf360c,stroke-width:2px
    style Unverified fill:#ffccbc,stroke:#bf360c,stroke-width:2px
    style Gate fill:#fff9c4,stroke:#f57f17,stroke-width:2px
''',

    "04_deployment_architecture": '''
flowchart TB
    subgraph Docker["Docker Container (Single Instance)"]
        subgraph Process["Node.js Process"]
            API[Express API<br/>Port 3000]
            Runner[Job Runner]
            Scheduler[Scheduler]
        end
        
        subgraph Volume["Persistent Volume /app/data"]
            JSON[JSON Files<br/>users, courses, etc.]
            SQLite[SQLite<br/>conversations.db]
            Files[File System<br/>uploads, chunks]
        end
    end
    
    subgraph External["External Services (HTTPS)"]
        Inception[Inception Labs API<br/>Primary LLM]
        Groq[Groq API<br/>Fallback LLM]
        Mistral[Mistral API<br/>Embeddings Only]
    end
    
    Browser[Client Browser] -->|HTTPS| API
    API --> JSON
    API --> SQLite
    API --> Files
    Runner --> JSON
    Scheduler --> JSON
    
    API -->|LLM Requests| Inception
    API -->|Fallback| Groq
    API -->|Embeddings| Mistral
    
    style Browser fill:#e3f2fd,stroke:#01579b,stroke-width:2px
    style Docker fill:#fff3e0,stroke:#e65100,stroke-width:2px
    style External fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
''',

    "05_data_stores": '''
flowchart LR
    subgraph JSON["JSON File Store (Single Writer)"]
        Users[users.json]
        Courses[courses.json]
        Docs[documents.json]
        Jobs[jobs.json]
        Events[activity_events.json]
    end
    
    subgraph SQLite["SQLite (WAL Mode)"]
        Conv[conversations<br/>table]
        Msg[messages<br/>table]
    end
    
    subgraph Files["File System"]
        Uploads[data/uploads/<br/>Original Files]
        Chunks[data/json/chunks/<br/>Document Embeddings]
    end
    
    App[Application<br/>Services] --> JSON
    App --> SQLite
    App --> Files
    
    style JSON fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style SQLite fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    style Files fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    style App fill:#c5cae9,stroke:#311b92,stroke-width:3px
''',

    "06_security_two_gate": '''
flowchart TB
    Request[Incoming Request<br/>with Bearer Token]
    AuthMW[Authentication Middleware]
    PermMW[Permission Middleware]
    Handler[Request Handler]
    Policy[Policy Layer]
    Response[Success Response]
    
    Deny1[401 Unauthorized<br/>Invalid/Expired Token]
    Deny2[403 Forbidden<br/>Missing Permission]
    Deny3[403 Forbidden<br/>Not Owner/Member]
    
    Request --> AuthMW
    AuthMW -->|Valid JWT| PermMW
    AuthMW -->|Invalid| Deny1
    PermMW -->|Has Permission| Handler
    PermMW -->|No Permission| Deny2
    Handler --> Policy
    Policy -->|Authorized| Response
    Policy -->|Not Authorized| Deny3
    
    style Request fill:#e3f2fd,stroke:#01579b,stroke-width:2px
    style Response fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px
    style Deny1 fill:#ffccbc,stroke:#bf360c,stroke-width:2px
    style Deny2 fill:#ffccbc,stroke:#bf360c,stroke-width:2px
    style Deny3 fill:#ffccbc,stroke:#bf360c,stroke-width:2px
''',

    "07_role_boundaries": '''
flowchart TB
    subgraph Learner["Learner Role"]
        L1[Own Conversations]
        L2[Personal Notes<br/>Private]
        L3[Enrolled Course Content]
        L4[Published Quizzes]
    end
    
    subgraph Coach["Coach Role"]
        C1[Own Courses]
        C2[Course Documents]
        C3[Enrolment Approval]
        C4[Aggregate Insights<br/>Min Cohort Size]
    end
    
    subgraph Admin["Admin Role"]
        A1[User Management]
        A2[Coach Approval]
        A3[System Config]
        A4[Audit Logs<br/>Metadata Only]
    end
    
    Boundary1[Cannot Access:<br/>Other Learners Notes<br/>Other Conversations]
    Boundary2[Cannot Access:<br/>Learner Conversations<br/>Personal Notes<br/>Message Text]
    Boundary3[Cannot Access:<br/>Course Content<br/>Documents<br/>Chunks<br/>Message Text]
    
    Learner -.->|Blocked| Boundary1
    Coach -.->|Blocked| Boundary2
    Admin -.->|Blocked| Boundary3
    
    style Learner fill:#bbdefb,stroke:#0d47a1,stroke-width:2px
    style Coach fill:#c5cae9,stroke:#311b92,stroke-width:2px
    style Admin fill:#f8bbd0,stroke:#880e4f,stroke-width:2px
''',

    "08_job_processing": '''
flowchart LR
    Service[Service Layer]
    Queue[Job Queue<br/>JSON Store]
    Runner[Job Runner<br/>In-Process]
    Handler[Job Handler<br/>Ingestion, Clustering, etc.]
    Success[Job Status: done]
    Failed[Job Status: failed]
    Dead[Job Status: dead<br/>Max Retries Exceeded]
    
    Service -->|Enqueue| Queue
    Queue -->|Claim & Lock| Runner
    Runner -->|Execute| Handler
    Handler -->|Success| Success
    Handler -->|Transient Error| Failed
    Failed -->|Retry with Backoff| Queue
    Failed -->|Max Attempts| Dead
    
    style Service fill:#bbdefb,stroke:#0d47a1,stroke-width:2px
    style Queue fill:#fff9c4,stroke:#f57f17,stroke-width:2px
    style Runner fill:#c5cae9,stroke:#311b92,stroke-width:2px
    style Success fill:#c8e6c9,stroke:#1b5e20,stroke-width:2px
    style Dead fill:#ffccbc,stroke:#bf360c,stroke-width:2px
''',

    "09_citation_validation": '''
flowchart TD
    Start[LLM Answer<br/>with Citations]
    V1{V1: All Cited ChunkIDs<br/>Exist in Context Set?}
    V2{V2: All Marker-ChunkID<br/>Pairs Match System?}
    V3{V3: All Markers in Text<br/>Have Citations?}
    V4{V4: Minimum Citations<br/>Requirement Met?}
    Pass[GROUNDED<br/>Return Answer with Citations]
    Fail[UNVERIFIED<br/>Suppress Answer]
    
    Start --> V1
    V1 -->|Yes| V2
    V1 -->|No| Fail
    V2 -->|Yes| V3
    V2 -->|No| Fail
    V3 -->|Yes| V4
    V3 -->|No| Fail
    V4 -->|Yes| Pass
    V4 -->|No| Fail
    
    style Start fill:#e3f2fd,stroke:#01579b,stroke-width:2px
    style Pass fill:#c8e6c9,stroke:#1b5e20,stroke-width:3px
    style Fail fill:#ffccbc,stroke:#bf360c,stroke-width:2px
''',

    "10_module_communication": '''
flowchart TB
    Auth[Auth Module<br/>JWT, Tokens, Roles]
    Course[Course Module<br/>CRUD, Ownership]
    Doc[Document Module<br/>Upload, Validation]
    Chat[Chat Module<br/>LangGraph Runner]
    Learning[Learning Module<br/>Quiz, Summary, Flashcards]
    Retrieval[Retrieval Module<br/>Vector Search + Access Filter]
    Jobs[Jobs Module<br/>Runner + Scheduler]
    
    Course -->|Auth Check| Auth
    Doc -->|Auth Check| Auth
    Doc -->|Course Validation| Course
    Chat -->|Auth Check| Auth
    Chat -->|Vector Search| Retrieval
    Learning -->|Auth Check| Auth
    Learning -->|Vector Search| Retrieval
    Retrieval -->|Chunk Access| Doc
    Doc -->|Enqueue Ingestion| Jobs
    
    style Auth fill:#ffcdd2,stroke:#b71c1c,stroke-width:2px
    style Course fill:#f8bbd0,stroke:#880e4f,stroke-width:2px
    style Doc fill:#d1c4e9,stroke:#4a148c,stroke-width:2px
    style Chat fill:#c5cae9,stroke:#311b92,stroke-width:2px
    style Learning fill:#bbdefb,stroke:#0d47a1,stroke-width:2px
    style Retrieval fill:#b3e5fc,stroke:#01579b,stroke-width:2px
    style Jobs fill:#c8e6c9,stroke:#1b5e20,stroke-width:2px
'''
}

def generate_diagram_cli(name: str, mermaid_code: str):
    """Generate diagram using mmdc CLI"""
    try:
        # Write mermaid file
        mmd_file = mmd_dir / f"{name}.mmd"
        with open(mmd_file, 'w', encoding='utf-8') as f:
            f.write(mermaid_code)
        
        # Generate PNG
        output_file = diagrams_dir / f"{name}.png"
        
        result = subprocess.run(
            ['mmdc', '-i', str(mmd_file), '-o', str(output_file), '-b', 'white', '-w', '1920', '-H', '1080'],
            capture_output=True,
            text=True,
            timeout=30
        )
        
        if result.returncode == 0 and output_file.exists():
            print(f"✓ Generated: {name}.png")
            return True
        else:
            print(f"✗ Failed {name}: {result.stderr[:100]}")
            return False
            
    except subprocess.TimeoutExpired:
        print(f"✗ Timeout: {name}")
        return False
    except Exception as e:
        print(f"✗ Error {name}: {str(e)[:100]}")
        return False

def main():
    print("="*70)
    print("Architecture Diagram Generator")
    print("Using mermaid-cli (mmdc)")
    print("="*70)
    print()
    
    # Check if mmdc is available
    try:
        result = subprocess.run(['mmdc', '--version'], capture_output=True, text=True, timeout=5)
        print(f"✓ mermaid-cli found: {result.stdout.strip()}\n")
    except:
        print("✗ mermaid-cli not found!")
        print("  Install with: npm install -g @mermaid-js/mermaid-cli")
        sys.exit(1)
    
    success_count = 0
    total_count = len(diagrams)
    
    print(f"Generating {total_count} diagrams...\n")
    
    for name, mermaid_code in diagrams.items():
        if generate_diagram_cli(name, mermaid_code.strip()):
            success_count += 1
    
    print()
    print("="*70)
    print(f"Results: {success_count}/{total_count} diagrams generated successfully")
    print(f"Output: {diagrams_dir.absolute()}")
    print("="*70)
    
    if success_count == total_count:
        print("\n✓ All diagrams generated successfully!")
        print("  Check docs/diagrams/ folder for PNG files")
    elif success_count > 0:
        print(f"\n! {total_count - success_count} diagrams failed")
        print("  Check error messages above")
    else:
        print("\n✗ All diagrams failed")
        print("  Ensure mermaid-cli is properly installed")

if __name__ == "__main__":
    main()
