# Change Log
## V2.0.3
- Support custom baudrate for SerialPort and use 460800 as default.
## V2.0.2
- Fix the error of not being able to install files with the new version of FlintESPJVM.
## V2.0.1
- Fix the bug of not syncing the result of WATCH evaluate with CALL STACK.
## V2.0.0
- There are almost no changes in terms of features in this version.
- This version is compatible with FlintJVM V2.0.0. Older versions will not be able to use it.
## V1.1.7
- Support read class file and source file from jar file.
- Check and notify if parameters in launch.json are invalid.
- Accept path as a string instead of forcing it to be an array in launch.json.
## V1.1.6
- Fix not working on Ubuntu.
## V1.1.5
- Fix error of not finding bridge method.
## V1.1.4
- Update DBG_CMD_READ_LOCAL command to be compatible with the latest version of FlintJVM.
- Fix bug and improve for add/remove breakpoint feature.
- Direct support for connecting to Flint server using COM port.
## V1.1.2
- Stable for the first communication with board.
## V1.1.1
- Fix bug relate to remove breakpoint.
- Fix bug related to viewing class fields in watch.
## V1.1.0
- Updated to be compatible with FlintJVM V1.1.0.
- Stable communication between Flint Client and Flint Server.
- Check and read the console buffer one last time before stop debugging.
- Fix incorrect expression evaluation.
- Supports direct display of BigInteger values ​​in VARIABLES and WATCH windows.
## V1.0.0
- Provides basic features:
  - Pause, Continue, Restart.
  - Step Over, Step Into, Step Out.
  - Stack trace.
  - Set and remove breakpoints.
  - Stop on exception and display exception information.
  - View local variables and evaluate expressions.
  - Display message printed from java code.