import sys

try:
    with open("test_result.txt", "w") as f:
        f.write("Starting Check...\n")
        
        try:
            import flask
            f.write(f"Flask: {flask.__version__}\n")
        except ImportError as e:
            f.write(f"Flask Missing: {e}\n")

        try:
            import serial
            f.write(f"Serial: {serial.__version__}\n")
        except ImportError as e:
            f.write(f"Serial Missing: {e}\n")

        try:
            import sklearn
            f.write(f"Sklearn: {sklearn.__version__}\n")
        except ImportError as e:
            f.write(f"Sklearn Missing: {e}\n")
            
        try:
            import pandas
            f.write(f"Pandas: {pandas.__version__}\n")
        except ImportError as e:
            f.write(f"Pandas Missing: {e}\n")
            
        f.write("Check Complete.\n")

except Exception as e:
    print(e)
