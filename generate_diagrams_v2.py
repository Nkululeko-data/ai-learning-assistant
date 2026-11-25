"""
Generate architecture diagram images using Mermaid.ink API.
Simpler diagrams optimized for rendering.
"""

import base64
import zlib
import urllib.parse
import requests
from pathlib import Path
import time

# Create diagrams directory
diagrams_dir = Path("docs/diagrams")
diagrams_dir.mkdir(parents=True, exist_ok=True)

def encode_mermaid(mermaid_code: str) -> str:
    """Encode mermaid code for mermaid.ink API"""
    # Compress and encode
    compressed = zlib.compress(mermaid_code.encode('utf-8'), 9)
    encoded = base64.urlsafe_b64encode(compressed).decode('utf-8')
    return encoded

def generate_diagram_mermaid_ink(mermaid_code: str, output_path: str):
    """Generate diagram using mermaid.ink API"""
    try:
        encoded = encode_mermaid(mermaid_code)
        url = f"https://mermaid.ink/img/{encoded}"
        
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        
        with open(output_path, 'wb') as f:
            f.write(response.content)
        
        print(f"✓ Generated: {output_path}")
        return True
    except Exception as e:
        print(f"✗ Failed {output_path}: {str(e)[:100]}")
        return False

# Simplified diagrams optimized for rendering
diagrams = {
    "01_system_overview": '''
graph TB
    Client[Client Browser]
    API[Express API]
    Services[Application Services]
    AI[LangGraph AI Layer]
    Storage[Data Storage]
    Jobs[Background Jobs]
    
    Client --> API
    API --> Services
    Services --> AI
    Services --> Storage
    Services --> Jobs
    
    style Client fill:#e3f2fd
    style API fill:#fff3e0
    style Services fill:#f3e5f5
    style AI fill:#e8f5e9
    style Storage fill:#fce4ec
    style Jobs fill:#fff9c4
''',

    "02_layer_architecture": '''
graph LR
    HTTP[HTTP Layer]
    App[Application]
    Domain[Domain]
    AI[AI Layer]
    Infra[Infrastructure]
    
    HTTP --> App
    App --> Domain
    App --> AI
    App --> Infra
    AI --> Infra
    
    style HTTP fill:#bbdefb
    style App fill:#c5cae9
    style Domain fill:#e1bee7
    style AI fill:#c8e6c9
    style Infra fill:#f8bbd0
''',

    "03_chat_graph": '''
graph TD
    Start([Start])
    QU[Query Understanding]
    RQ[Rewrite Query]
    Retrieve[Retrieval]
    Context[Context Builder]
    Gate[Evidence Gate]
    Generate[Answer Generation]
    Validate[Citation Validator]
    End([End])
    
    Start --> QU
    QU --> RQ
    RQ --> Retrieve
    Retrieve --> Context
    Context --> Gate
    Gate -->|Pass| Generate
    Gate -->|Fail| End
    Generate --> Validate
    Validate --> End
    
    style Start fill:#e8f5e9
    style End fill:#c8e6c9
    style Gate fill:#fff9c4
''',

    "04_deployment": '''
graph TB
    subgraph Container[Docker Container]
        Process[Node.js Process]
        Volume[Persistent Volume]
    end
    
    subgraph External[External Services]
        Inception[Inception API]
        Groq[Groq API]
        Mistral[Mistral API]
    end
    
    Browser[Browser] --> Process
    Process --> Volume
    Process --> Inception
    Process --> Groq
    Process --> Mistral
    
    style Browser fill:#e3f2fd
    style Process fill:#c5cae9
    style Volume fill:#fff9c4
''',

    "05_data_stores": '''
graph LR
    subgraph JSON[JSON Store]
        Users[users.json]
        Courses[courses.json]
        Docs[documents.json]
        Jobs[jobs.json]
    end
    
    subgraph SQLite[SQLite DB]
        Conv[conversations]
        Msg[messages]
    end
    
    subgraph Files[File System]
        Uploads[uploads/]
        Chunks[chunks/]
    end
    
    App[Application] --> JSON
    App --> SQLite
    App --> Files
    
    style JSON fill:#fff9c4
    style SQLite fill:#e1f5fe
    style Files fill:#f3e5f5
''',

    "06_security_model": '''
graph TB
    Request[User Request]
    Auth[JWT Authentication]
    Perm[Permission Check]
    Owner[Ownership Check]
    Handler[Request Handler]
    Response[Response]
    
    Request --> Auth
    Auth -->|Valid| Perm
    Auth -->|Invalid| Deny1[401 Unauthorized]
    Perm -->|Has Permission| Owner
    Perm -->|No Permission| Deny2[403 Forbidden]
    Owner -->|Authorized| Handler
    Owner -->|Not Authorized| Deny3[403 Forbidden]
    Handler --> Response
    
    style Request fill:#e3f2fd
    style Response fill:#c8e6c9
    style Deny1 fill:#ffccbc
    style Deny2 fill:#ffccbc
    style Deny3 fill:#ffccbc
''',

    "07_role_access": '''
graph LR
    subgraph Learner
        L1[Own conversations]
        L2[Personal notes]
        L3[Enrolled courses]
    end
    
    subgraph Coach
        C1[Own courses]
        C2[Course documents]
        C3[Aggregate insights]
    end
    
    subgraph Admin
        A1[User management]
        A2[System config]
        A3[Audit logs]
    end
    
    style Learner fill:#bbdefb
    style Coach fill:#c5cae9
    style Admin fill:#f8bbd0
''',

    "08_job_processing": '''
graph LR
    Service[Service]
    Queue[Job Queue]
    Runner[Job Runner]
    Handler[Job Handler]
    Complete[Complete]
    
    Service -->|Enqueue| Queue
    Queue -->|Claim| Runner
    Runner -->|Execute| Handler
    Handler -->|Success| Complete
    Handler -->|Retry| Queue
    
    style Service fill:#bbdefb
    style Queue fill:#fff9c4
    style Runner fill:#c5cae9
    style Complete fill:#c8e6c9
''',

    "09_citation_flow": '''
graph TD
    Answer[LLM Answer + Citations]
    V1{ChunkIds Exist?}
    V2{Markers Match?}
    V3{All Cited?}
    V4{Min Count?}
    Pass[GROUNDED]
    Fail[UNVERIFIED]
    
    Answer --> V1
    V1 -->|Yes| V2
    V1 -->|No| Fail
    V2 -->|Yes| V3
    V2 -->|No| Fail
    V3 -->|Yes| V4
    V3 -->|No| Fail
    V4 -->|Yes| Pass
    V4 -->|No| Fail
    
    style Answer fill:#e3f2fd
    style Pass fill:#c8e6c9
    style Fail fill:#ffccbc
''',

    "10_module_dependencies": '''
graph TB
    Auth[Auth Module]
    Course[Course Module]
    Doc[Document Module]
    Chat[Chat Module]
    Learning[Learning Module]
    Retrieval[Retrieval Module]
    
    Course --> Auth
    Doc --> Auth
    Doc --> Course
    Chat --> Auth
    Chat --> Retrieval
    Learning --> Auth
    Learning --> Retrieval
    Retrieval --> Doc
    
    style Auth fill:#ffcdd2
    style Course fill:#f8bbd0
    style Doc fill:#d1c4e9
    style Chat fill:#c5cae9
    style Learning fill:#bbdefb
    style Retrieval fill:#b3e5fc
'''
}

def main():
    print("Generating simplified architecture diagrams...")
    print(f"Using mermaid.ink API\n")
    
    success_count = 0
    total_count = len(diagrams)
    
    for name, mermaid_code in diagrams.items():
        output_path = diagrams_dir / f"{name}.png"
        if generate_diagram_mermaid_ink(mermaid_code.strip(), str(output_path)):
            success_count += 1
        time.sleep(1)  # Be respectful to the API
    
    print(f"\n{'='*70}")
    print(f"Success: {success_count}/{total_count} diagrams generated")
    print(f"Output: {diagrams_dir.absolute()}")
    print(f"{'='*70}")
    
    if success_count > 0:
        print("\n✓ Diagrams are ready!")
        print("  You can now view them in the docs/diagrams/ folder")
    
    if success_count < total_count:
        print("\n! Some diagrams failed. Alternative options:")
        print("  1. Install mermaid-cli: npm install -g @mermaid-js/mermaid-cli")
        print("  2. Use https://mermaid.live/ to generate manually")
        print("  3. The SYSTEM-ARCHITECTURE.md contains all Mermaid code")

if __name__ == "__main__":
    main()
